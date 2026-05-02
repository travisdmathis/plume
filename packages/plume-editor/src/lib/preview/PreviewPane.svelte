<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { Timer } from "three";
  import { WebGPURenderer } from "three/webgpu";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { Manager, system } from "plume";

  /**
   * Preview pane bumps `applyTick` whenever the user clicks "Apply" in the header. We watch
   * it via a `$effect` so each click rebuilds the spawned system from the current graph
   * (graph→def compilation lands in a follow-up — for now the preview just respawns a
   * hardcoded smoke preset to prove the loop).
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

  function buildPlaceholderPreset(): Parameters<Manager["register"]>[1] {
    // Hardcoded smoke puff so the preview shows something meaningful from frame zero.
    // Replaced once the graph compiler is wired up.
    return () =>
      system("editor_preview")
        .duration(3.5)
        .emitter("puff", (e) =>
          e
            .capacity(128)
            .duration(1.5)
            .spawnRate(25)
            .lifetime({ min: 1.8, max: 2.8 })
            .position({ shape: { kind: "sphere", radius: 0.08, thickness: 1 } })
            .velocity({
              shape: { kind: "cone", angle: Math.PI * 0.18 },
              speed: { min: 0.3, max: 1 },
            })
            .size({ min: 0.35, max: 0.7 })
            .color({ min: [0.65, 0.65, 0.68], max: [0.85, 0.85, 0.9] }, { alpha: 0.35 })
            .rotation({ min: 0, max: Math.PI * 2 })
            .integrate()
            .drag(0.4)
            .gravity([0, 0.5, 0])
            .sizeOverLife([
              [0, 0.8],
              [0.5, 1.4],
              [1, 2],
            ])
            .alphaOverLife([
              [0, 0],
              [0.3, 1],
              [1, 0],
            ])
            .renderSprite({ blending: "alpha" }),
        )
        .build();
  }

  onMount(async () => {
    if (!host) return;

    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(new THREE.Color(0x0b0c10));
    host.appendChild(renderer.domElement);
    await renderer.init();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(2, 2, 4);
    camera.lookAt(0, 0.5, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;

    scene.add(new THREE.GridHelper(10, 10, 0x222326, 0x16171a));

    manager = new Manager({ renderer, scene, camera, maxActive: 8 });
    manager.register("editor_preview", buildPlaceholderPreset());
    await manager.warmup();

    timer = new Timer();
    timer.connect(document);

    onResize = (): void => {
      if (!renderer || !camera || !host) return;
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    function tick(): void {
      if (!renderer || !scene || !camera || !timer || !manager || !controls) return;
      timer.update();
      const dt = Math.min(timer.getDelta(), 1 / 30);
      controls.update();
      manager.tick(dt, camera);
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }
    tick();
  });

  // React to "Apply" clicks: clear and respawn from the (currently hardcoded) preset.
  $effect(() => {
    // Read the dependency so the effect re-runs on each click. Skip the initial 0 click —
    // the preview's first spawn happens in onMount via warmup().
    if (applyTick === 0) return;
    if (!manager) return;
    manager.clear();
    manager.spawn("editor_preview", { position: new THREE.Vector3(0, 0.5, 0) });
  });

  onDestroy(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    if (onResize) window.removeEventListener("resize", onResize);
    manager?.dispose();
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
