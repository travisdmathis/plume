<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import * as THREE from "three";
  import { Timer } from "three";
  import { WebGPURenderer, MeshStandardNodeMaterial, PostProcessing } from "three/webgpu";
  import { pass } from "three/tsl";
  import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import { Manager } from "three-plume";

  import { graphStore, updateNodeParam } from "../graph/graphStore.svelte.js";
  import { getSpec } from "../builder/nodes.js";
  import { compileGraph, CompileError, type CompileContext } from "../builder/compile.js";
  import { editorStore } from "../state.svelte.js";

  /** Vec3 field keys that get a draggable in-scene gizmo when the owning node
   *  is selected. Restricted to clearly positional fields so axis/colour vec3s
   *  don't sprout meaningless arrows. */
  const POSITION_LIKE_KEYS = new Set(["position", "center", "origin", "point"]);

  interface Gizmo {
    proxy: THREE.Object3D;
    ctrl: TransformControls;
    helper: THREE.Object3D;
    fieldKey: string;
  }

  /**
   * Preview pane: WebGPU scene with IBL + bloom post-processing, an off-screen
   * depth pass for `DepthCollision`, and a soft ground plane so lit-particle
   * effects (`MeshRenderer` + `LightEmission`) actually land on something.
   *
   * Two trigger paths:
   *   1. Header "Apply" button (`applyTick` increments).
   *   2. Live mode — debounced auto-rebuild on any graph change.
   *
   * Loop: each compiled System is `loop()`-tagged so it keeps emitting once
   * spawned. We don't restart it ourselves.
   */
  let { applyTick }: { applyTick: number } = $props();

  let host: HTMLDivElement | undefined = $state();
  let renderer: WebGPURenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let manager: Manager | undefined;
  let timer: Timer | undefined;
  let rafId: number | undefined;
  let onResize: (() => void) | undefined;
  let registeredCount = 0;
  let currentPreviewId: string | undefined;
  let ready = false;

  // PostProcessing pipeline drives the final image through scene-pass + bloom.
  // Without bloom HDR particle colours look LDR — every Niagara-tier reference
  // VFX has it, so it's a baseline rendering feature, not a polish step.
  let postProcessing: PostProcessing | undefined;

  // Off-screen depth target. `update.depth_collision` reads from this; the
  // ground plane + any opaque mesh particles render here once per frame.
  // Only allocated when at least one `update.depth_collision` node is present
  // in the current graph — a graph that doesn't need depth shouldn't pay for
  // an extra render-target pass each frame.
  let depthTarget: THREE.RenderTarget | undefined;
  let depthScene: THREE.Scene | undefined; // mirrors the main scene's opaque content
  let depthPassEnabled = false;

  // Ground plane reference so we can keep it in sync between main + depth scenes.
  let ground: THREE.Mesh | undefined;

  let liveDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Active gizmos keyed by nodeId:fieldKey. Recomputed on selection / graph
  // changes. Disposed eagerly so dragging old gizmos can't ghost-write back
  // into stale params.
  let gizmos: Map<string, Gizmo> = new Map();

  function makeDepthTarget(w: number, h: number): THREE.RenderTarget {
    const t = new THREE.RenderTarget(w, h, {
      depthBuffer: true,
      // Storing depth as a texture lets us sample it from compute shaders.
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedShortType),
    });
    return t;
  }

  onMount(async () => {
    if (!host) return;

    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    // Near-black background so HDR effects pop. Bloom is the multiplier here —
    // a mid-grey background flattens contrast and kills the wow factor.
    renderer.setClearColor(new THREE.Color(0x05060a));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);
    await renderer.init();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    // Dim ambient + low-angle key/fill so the floor reads as a dark glossy
    // surface but isn't pitch black. The fire/particle effects supply most of
    // the actual scene illumination via bloom + emissive HDR colours.
    const ambient = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.35);
    key.position.set(3, 5, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.12);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    // Dark glossy floor — low metalness with low roughness gives a near-mirror
    // ground that picks up the fire's reflection (the "wet asphalt" look every
    // Niagara demo uses to sell bright effects).
    const groundMat = new MeshStandardNodeMaterial();
    groundMat.color = new THREE.Color(0x080a10);
    groundMat.roughness = 0.35;
    groundMat.metalness = 0.0;
    ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Subtle wire grid floats just above the ground plane for orientation.
    const grid = new THREE.GridHelper(10, 10, 0x202430, 0x101218);
    grid.position.y = 0.001;
    scene.add(grid);

    camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(2, 2, 4);
    camera.lookAt(0, 0.5, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;

    manager = new Manager({ renderer, scene, camera, maxActive: 8 });

    timer = new Timer();
    timer.connect(document);

    // ── Post-processing pipeline ──
    // Render the scene into a TSL `pass`, then add a bloom node on top. The
    // PostProcessing object owns the final blit to the canvas, so we DON'T
    // call renderer.render(scene, camera) directly anymore — that would draw
    // the un-bloomed image OVER our composited result.
    postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    // strength=0.7 gives a healthy halo without nuking everything;
    // radius=0.85 spreads the glow widely; threshold=0.6 means only HDR pixels
    // (intensity > ~0.6 post-tonemap) contribute to bloom.
    const bloomPass = bloom(scenePass, 0.7, 0.85, 0.6);
    postProcessing.outputNode = scenePass.add(bloomPass);

    // Depth scene mirrors the ground plane — built lazily the first time a
    // graph compile asks for depth_collision (see ensureDepthPass).
    onResize = (): void => {
      if (!renderer || !camera || !host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      depthTarget?.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    function tick(): void {
      if (!renderer || !scene || !camera || !timer || !manager || !controls || !postProcessing) return;
      timer.update();
      const dt = Math.min(timer.getDelta(), 1 / 30);
      controls.update();
      manager.tick(dt, camera);

      // Refresh depth texture (depth_collision input) before the main pass.
      if (depthPassEnabled && depthScene && depthTarget) {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(depthTarget);
        renderer.render(depthScene, camera);
        renderer.setRenderTarget(prev);
      }

      // PostProcessing.render() drives the entire scene → bloom → screen path.
      postProcessing.render();
      rafId = requestAnimationFrame(tick);
    }
    tick();

    ready = true;
  });

  function previewContext(): CompileContext {
    return {
      depthTexture: depthTarget?.depthTexture ?? undefined,
      camera,
    };
  }

  function ensureDepthPass(): void {
    if (depthPassEnabled || !host || !scene) return;
    depthScene = new THREE.Scene();
    const groundDepth = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new MeshStandardNodeMaterial(),
    );
    groundDepth.rotation.x = -Math.PI / 2;
    depthScene.add(groundDepth);
    depthTarget = makeDepthTarget(host.clientWidth, host.clientHeight);
    depthPassEnabled = true;
  }

  async function rebuildAndSpawn(): Promise<void> {
    if (!manager) {
      editorStore.statusText = "Apply ignored — preview not initialized yet.";
      return;
    }
    if (!ready) {
      editorStore.statusText = "Apply ignored — preview still warming up.";
      return;
    }

    // If any node in the current graph asks for depth_collision, allocate the
    // depth pass once (idempotent) before compiling so the context has a valid
    // depthTexture to hand to the module.
    if (graphStore.nodes.some((n) => n.data.type === "update.depth_collision")) {
      ensureDepthPass();
    }

    let result;
    try {
      result = compileGraph(graphStore.nodes, graphStore.edges, previewContext());
    } catch (err) {
      const msg = err instanceof CompileError ? err.message : String(err);
      editorStore.statusText = `Compile error: ${msg}`;
      return;
    }

    const id = `editor_graph_${++registeredCount}`;
    const previousId = currentPreviewId;
    editorStore.statusText = `Compiling ${result.summary}…`;

    manager.register(id, result.def);
    try {
      await manager.preload(id, 1);
    } catch (err) {
      manager.unregister(id);
      editorStore.statusText = `Warmup failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[plume-editor] warmup error:", err);
      return;
    }

    manager.clear();
    if (previousId) manager.unregister(previousId);
    currentPreviewId = id;

    // Take the spawnOrigin from the first emitter node so users can place
    // emitters at non-origin positions (rain at the sky, lightning at altitude,
    // etc.). For multi-emitter graphs all emitters share this transform —
    // additional offsets need to be baked into per-emitter init.position.
    const firstEmitter = graphStore.nodes.find(
      (n) => getSpec(n.data.type).category === "emitter",
    );
    const origin = firstEmitter?.data.params.spawnOrigin;
    const pos = Array.isArray(origin) && origin.length === 3
      ? new THREE.Vector3(origin[0] as number, origin[1] as number, origin[2] as number)
      : new THREE.Vector3(0, 0.5, 0);

    const sys = manager.spawn(id, { position: pos });
    if (!sys) {
      manager.unregister(id);
      currentPreviewId = undefined;
      editorStore.statusText = `Spawn returned null (at capacity?) — ${result.summary}`;
      return;
    }

    editorStore.statusText = `${editorStore.live ? "Live (auto)" : "Live"} · ${result.summary}`;
  }

  function disposeGizmo(g: Gizmo): void {
    g.ctrl.detach();
    g.ctrl.dispose();
    if (scene) {
      scene.remove(g.helper);
      scene.remove(g.proxy);
    }
  }

  function makeGizmo(nodeId: string, fieldKey: string, position: [number, number, number]): Gizmo {
    if (!scene || !camera || !renderer || !controls) {
      throw new Error("makeGizmo: scene not initialized");
    }
    const proxy = new THREE.Object3D();
    proxy.position.set(position[0], position[1], position[2]);
    scene.add(proxy);

    // A small visual marker so users can see where the gizmo lives even when
    // the TransformControls' arrow tips occlude.
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x9ae6b4, transparent: true, opacity: 0.6 }),
    );
    proxy.add(marker);

    const ctrl = new TransformControls(camera, renderer.domElement);
    ctrl.attach(proxy);
    ctrl.setSize(0.6);
    // The controls' helper is what shows the gizmo gizmo arrows in scene.
    const helper = ctrl.getHelper();
    scene.add(helper);

    // Pause OrbitControls while dragging so camera doesn't fight the user.
    ctrl.addEventListener("dragging-changed", (event: { value: unknown }) => {
      if (controls) controls.enabled = !event.value;
    });
    ctrl.addEventListener("objectChange", () => {
      const p = proxy.position;
      // Round to keep saved JSON tidy.
      const r = (n: number): number => Math.round(n * 1000) / 1000;
      updateNodeParam(nodeId, fieldKey, [r(p.x), r(p.y), r(p.z)]);
    });

    return { proxy, ctrl, helper, fieldKey };
  }

  // Sync gizmos with the selected node's position-like vec3 fields. Runs on
  // every selection or graph-content change.
  $effect(() => {
    if (!ready || !scene) return;
    const selectedId = graphStore.selectedId;
    const nodes = graphStore.nodes;

    untrack(() => {
      const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
      const wantedKeys = new Set<string>();
      if (selectedNode) {
        const spec = getSpec(selectedNode.data.type);
        for (const f of spec.fields) {
          if (f.kind === "vec3" && POSITION_LIKE_KEYS.has(f.key)) {
            wantedKeys.add(`${selectedNode.id}:${f.key}`);
          }
        }
      }

      // Drop gizmos no longer wanted.
      for (const [key, g] of gizmos) {
        if (!wantedKeys.has(key)) {
          disposeGizmo(g);
          gizmos.delete(key);
        }
      }

      // Add or sync gizmos for every wanted key.
      for (const key of wantedKeys) {
        const colon = key.indexOf(":");
        const nodeId = key.slice(0, colon);
        const fieldKey = key.slice(colon + 1);
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        const v = node.data.params[fieldKey];
        const pos: [number, number, number] = Array.isArray(v) && v.length === 3
          ? [v[0] as number, v[1] as number, v[2] as number]
          : [0, 0, 0];

        const existing = gizmos.get(key);
        if (existing) {
          // Sync if param changed externally (inspector typing).
          existing.proxy.position.set(pos[0], pos[1], pos[2]);
        } else {
          gizmos.set(key, makeGizmo(nodeId, fieldKey, pos));
        }
      }
    });
  });

  // Apply button — skip the initial 0 click.
  $effect(() => {
    if (applyTick === 0) return;
    void rebuildAndSpawn();
  });

  // Live mode: rebuild whenever any node, edge, or selectedId changes.
  $effect(() => {
    graphStore.nodes;
    graphStore.edges;

    if (!editorStore.live) return;

    untrack(() => {
      if (liveDebounceTimer !== undefined) clearTimeout(liveDebounceTimer);
      liveDebounceTimer = setTimeout(() => {
        void rebuildAndSpawn();
      }, 300);
    });
  });

  onDestroy(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    if (onResize) window.removeEventListener("resize", onResize);
    if (liveDebounceTimer !== undefined) clearTimeout(liveDebounceTimer);
    for (const g of gizmos.values()) disposeGizmo(g);
    gizmos.clear();
    manager?.dispose();
    depthTarget?.dispose();
    renderer?.dispose();
  });
</script>

<div class="preview-host" bind:this={host}></div>

<style>
  .preview-host {
    width: 100%;
    height: 100%;
    background: #0b0c10;
  }
</style>
