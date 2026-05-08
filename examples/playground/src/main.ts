import * as THREE from "three";
import { Timer } from "three";
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Emitter,
  Manager,
  dumpShaders,
  emitter,
  scrollUV,
  sdfBox,
  sdfSphere,
  sdfUnion,
  softCircleTexture,
  system,
  systemDefFromJSON,
  systemDefToJSON,
  type SystemDef,
} from "three-plume";
import { vec2, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

// ────────────────────────────────────────────────────────────────────────────
// Scene setup
// ────────────────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;
const statsEl = document.getElementById("stats")!;

const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(new THREE.Color(0x0b0c10));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

await renderer.init();
const isWebGPU =
  (renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend === true;
console.info(`plume: renderer backend = ${isWebGPU ? "WebGPU" : "WebGL2"}`);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(6, 5, 10);
camera.lookAt(0, 1, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

const grid = new THREE.GridHelper(20, 20, 0x222326, 0x16171a);
scene.add(grid);

const axes = new THREE.AxesHelper(1.5);
axes.position.y = 0.001;
scene.add(axes);

// A soft hemisphere light so non-particle geometry isn't pitch black
scene.add(new THREE.HemisphereLight(0x6680aa, 0x1a1e2a, 0.8));

// ────────────────────────────────────────────────────────────────────────────
// Collidable scene geometry — used both as visible props in the main scene AND
// in a depth-only pre-pass that feeds `DepthCollision` (R11).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Each collidable records the shape parameters alongside its mesh so downstream code
 * (R15's SDF demo) can rebuild an equivalent analytic SDF from the same numbers the visual
 * geometry uses — one source of truth, no drift between what you see and what you collide.
 */
type CollidableShape =
  | { kind: "box"; center: [number, number, number]; halfSize: [number, number, number] }
  | { kind: "sphere"; center: [number, number, number]; radius: number };
const collidables: THREE.Mesh[] = [];
const collidableShapes: CollidableShape[] = [];

function addBoxCollidable(
  center: [number, number, number],
  size: [number, number, number],
  color: number,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.set(center[0], center[1], center[2]);
  scene.add(mesh);
  collidables.push(mesh);
  collidableShapes.push({
    kind: "box",
    center,
    halfSize: [size[0] / 2, size[1] / 2, size[2] / 2],
  });
}

function addSphereCollidable(
  center: [number, number, number],
  radius: number,
  color: number,
): void {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.set(center[0], center[1], center[2]);
  scene.add(mesh);
  collidables.push(mesh);
  collidableShapes.push({ kind: "sphere", center, radius });
}

// Warm-toned unlit floor + two boxes + a sphere so blue rain droplets stand out and the
// SDF demo has a curved surface to bounce off too. The sphere sits where the third center
// box used to live so the scene composition stays familiar.
addBoxCollidable([0, -0.1, 0], [14, 0.2, 14], 0x4a3a2a); // floor
addBoxCollidable([-2.5, 0.7, -1], [2, 1.4, 2], 0xb07848);
addBoxCollidable([2.5, 1.1, -0.5], [1.4, 2.2, 1.4], 0xb07848);
addSphereCollidable([0, 0.75, 2.2], 0.75, 0xc68a5f);

// Depth pre-pass target. Holds a DepthTexture that `DepthCollision` samples each frame.
// Sized to the canvas; resized alongside it.
const depthRT = new THREE.RenderTarget(window.innerWidth, window.innerHeight);
const depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight);
depthTexture.format = THREE.DepthFormat;
depthTexture.type = THREE.UnsignedIntType;
depthRT.depthTexture = depthTexture;

// A throwaway scene holding JUST the collidables (second Mesh instance per collidable,
// sharing geometry + material with the main scene so they stay in lockstep). The depth
// pass uses this instead of `scene` so particles don't pollute the depth buffer — we want
// them to collide with WORLD geometry, not with each other.
const depthScene = new THREE.Scene();
for (const mesh of collidables) {
  const clone = new THREE.Mesh(mesh.geometry, mesh.material);
  clone.position.copy(mesh.position);
  clone.rotation.copy(mesh.rotation);
  clone.scale.copy(mesh.scale);
  depthScene.add(clone);
}

// Socket-follow demo prop. The blade tip is an Object3D so the effect can use the exact
// API a game would use for a sword bone/socket: `bladeTip.getWorldPosition(out)`.
const swordRig = new THREE.Group();
const blade = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 1.7, 0.12),
  new THREE.MeshBasicMaterial({ color: 0xbfd8ff }),
);
blade.position.y = 0.85;
const hilt = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 0.12, 0.18),
  new THREE.MeshBasicMaterial({ color: 0xf2b866 }),
);
const bladeTip = new THREE.Object3D();
bladeTip.position.y = 1.75;
swordRig.position.set(-1.1, 0.8, 1.1);
swordRig.add(blade, hilt, bladeTip);
scene.add(swordRig);
let swordSwingStart = -10;

function updateSwordRig(time: number): void {
  const t = Math.max(0, Math.min(1, (time - swordSwingStart) / 1.1));
  const ease = 1 - Math.pow(1 - t, 3);
  const idle = Math.sin(time * 1.6) * 0.08;
  swordRig.rotation.set(
    -0.4 + Math.sin(ease * Math.PI) * 0.9,
    -0.7 + ease * 1.6 + idle,
    1.25 - ease * 2.7,
  );
  swordRig.position.y = 0.8 + Math.sin(ease * Math.PI) * 0.35;
}

// ────────────────────────────────────────────────────────────────────────────
// Post-processing: HDR + bloom (TSL graph)
// ────────────────────────────────────────────────────────────────────────────

const renderPipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const bloomPass = bloom(scenePass, 0.9, 0.5, 0.85);
renderPipeline.outputNode = scenePass.add(bloomPass);

// ────────────────────────────────────────────────────────────────────────────
// Plume manager + prefabs
// ────────────────────────────────────────────────────────────────────────────

// `maxPoolPer: 64` is sized so the LOD-grid demo (49 fountains) can pop entirely from the
// pool instead of constructing fresh Systems mid-click — avoids a compile storm.
const manager = new Manager({ renderer, scene, camera, maxActive: 128, maxPoolPer: 64 });

/** Fiery explosion — flash + fire burst + dense rising smoke. */
function explosionDef(): SystemDef {
  return (
    system("explosion")
      .duration(3.0)
      // Phase 3: dark smoke plume — added first so it renders behind the fire.
      .emitter("smoke", (e) =>
        e
          .capacity(256)
          .duration(0.6)
          .spawnBurst([
            { time: 0.15, count: 60 },
            { time: 0.3, count: 50 },
          ])
          .lifetime({ min: 1.4, max: 2.2 })
          // surface of a 0.8m sphere (thickness 0.15) — keeps smoke out of the fire's emission point
          .position({ shape: { kind: "sphere", radius: 0.8, thickness: 0.15 } })
          .velocity({
            shape: { kind: "cone", angle: Math.PI * 0.45 },
            speed: { min: 1.2, max: 3 },
          })
          .size({ min: 0.5, max: 1.1 })
          .color({ min: [0.18, 0.16, 0.15], max: [0.32, 0.28, 0.26] }, { alpha: 0.45 })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -1.6, max: 1.6 } })
          .integrate()
          .gravity([0, 2.0, 0])
          .drag(1.0)
          .sizeOverLife([
            [0, 1],
            [1, 2.2],
          ])
          .alphaOverLife([
            [0, 0.9],
            [0.3, 1],
            [1, 0],
          ])
          .renderSprite({ blending: "alpha", renderOrder: 10 }),
      )
      // Phase 2: bright fire spray — fast outward burst of hot particles.
      .emitter("fire", (e) =>
        e
          .capacity(512)
          .duration(0.08)
          .spawnBurst({ time: 0, count: 380 })
          .lifetime({ min: 0.45, max: 0.95 })
          .position({ shape: { kind: "sphere", radius: 0.15, thickness: 1 } })
          .velocity({
            shape: { kind: "sphere", radius: 1 },
            speed: { min: 6, max: 16 },
          })
          .size({ min: 0.35, max: 0.8 })
          .color({
            kind: "list",
            values: [
              [1.0, 0.95, 0.75],
              [1.0, 0.7, 0.25],
              [1.0, 0.45, 0.1],
            ],
          })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -5, max: 5 } })
          .integrate()
          .gravity([0, 6, 0]) // strong buoyancy
          .drag(2.2)
          .turbulence({ amplitude: 12, frequency: 1.2, speed: 2.5 })
          .colorOverLife([
            { t: 0, color: [3.5, 2.6, 1.2, 1] }, // HDR hot core — above bloom threshold
            { t: 0.25, color: [2.0, 0.9, 0.25, 1] },
            { t: 0.7, color: [0.6, 0.15, 0.05, 1] },
            { t: 1, color: [0.08, 0.03, 0.02, 1] },
          ])
          .sizeOverLife([
            [0, 1],
            [0.3, 1.4],
            [1, 0.5],
          ])
          .alphaOverLife([
            [0, 1],
            [0.5, 0.8],
            [1, 0],
          ])
          .renderSprite({ blending: "additive", renderOrder: 20 }),
      )
      // Phase 1: instantaneous bright flash (single huge additive quad).
      .emitter("flash", (e) =>
        e
          .capacity(4)
          .duration(0.02)
          .spawnBurst({ time: 0, count: 3 })
          .lifetime(0.18)
          .position({ shape: { kind: "point" } })
          .velocity({ shape: { kind: "point" }, speed: 0 })
          .size({ min: 4.5, max: 6.5 })
          .color([1.0, 0.95, 0.75], { alpha: 1 })
          .rotation({ min: 0, max: Math.PI * 2 })
          .integrate()
          .colorOverLife([
            { t: 0, color: [4.0, 3.2, 2.0, 1] }, // bright HDR flash core
            { t: 0.4, color: [2.0, 1.5, 0.8, 1] },
            { t: 1, color: [0.2, 0.1, 0.05, 1] },
          ])
          .sizeOverLife([
            [0, 1],
            [0.5, 1.4],
            [1, 0.2],
          ])
          .alphaOverLife([
            [0, 1],
            [0.2, 0.9],
            [1, 0],
          ])
          .renderSprite({ blending: "additive", renderOrder: 30 }),
      )
      .build()
  );
}

/**
 * Soft continuous pale-grey smoke puff — no fire, no flash.
 * Authored with the R6 fluent builder. Behavior matches the previous array-of-modules
 * version; this is the go-to form for new presets.
 */
function smokePuffDef(): SystemDef {
  return system("smoke_puff")
    .duration(3.5)
    .emitter("puff", (e) =>
      e
        .capacity(128)
        .duration(1.5)
        .sortByDepth()
        .spawnRate(25)
        .lifetime({ min: 1.8, max: 2.8 })
        .position({ shape: { kind: "sphere", radius: 0.08, thickness: 1 } })
        .velocity({
          shape: { kind: "cone", angle: Math.PI * 0.18 },
          speed: { min: 0.3, max: 1.0 },
        })
        .size({ min: 0.35, max: 0.7 })
        .color({ min: [0.65, 0.65, 0.68], max: [0.85, 0.85, 0.9] }, { alpha: 0.35 })
        .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -0.6, max: 0.6 } })
        .integrate()
        .drag(0.4)
        .gravity([0, 0.5, 0])
        .sizeOverLife([
          [0, 0.8],
          [0.5, 1.4],
          [1, 2.0],
        ])
        .alphaOverLife([
          [0, 0.4],
          [0.3, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "alpha" }),
    )
    .build();
}

/** Magic orb — particles spawn in a wide ring, spiral inward toward origin with turbulence. */
function magicOrbDef(): SystemDef {
  return system("magic_orb")
    .duration(4)
    .emitter("wisps", (e) =>
      e
        .capacity(400)
        .duration(3)
        .spawnRate(140)
        .lifetime({ min: 1.2, max: 2.0 })
        .position({ shape: { kind: "sphere", radius: 2.5, thickness: 0.15 } })
        .velocity({
          shape: { kind: "sphere", radius: 1 },
          speed: { min: 0.2, max: 0.6 },
        })
        .size({ min: 0.1, max: 0.22 })
        .color({
          kind: "list",
          values: [
            [0.35, 0.75, 2.2],
            [1.8, 0.45, 2.4],
            [0.9, 1.6, 2.6],
          ],
        })
        .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -2, max: 2 } })
        .integrate()
        // Pull wisps inward toward a point 1.2m above emitter origin
        .pointAttractor({
          position: [0, 1.2, 0],
          strength: 8,
          radius: 5,
          falloff: "inverse",
        })
        .turbulence({ amplitude: 3, frequency: 1.8, speed: 1.2, octaves: 2 })
        .drag(0.6)
        .sizeOverLife([
          [0, 0.3],
          [0.3, 1],
          [1, 0],
        ])
        .alphaOverLife([
          [0, 0],
          [0.2, 1],
          [0.9, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "additive", renderOrder: 15 }),
    )
    .build();
}

/** Continuous radial burst driven by VelocityOverLife — dandelion-ish puffball. */
function sparkleFountainDef(): SystemDef {
  return system("sparkle_fountain")
    .duration(4)
    .emitter("fountain", (e) =>
      e
        .capacity(400)
        .duration(3)
        .spawnRate(120)
        .lifetime({ min: 0.8, max: 1.4 })
        .position({ shape: { kind: "point" } })
        .velocity({
          shape: { kind: "cone", angle: Math.PI * 0.4 },
          speed: { min: 3, max: 6 },
        })
        .size({ min: 0.08, max: 0.18 })
        .color({
          kind: "list",
          values: [
            [2.4, 2.0, 0.6],
            [2.2, 1.2, 0.3],
            [1.6, 2.2, 0.9],
          ],
        })
        .rotation({ min: 0, max: Math.PI * 2 })
        // Slow down hard over life, then re-apply gravity for the classic arc fall.
        .velocityOverLife([
          [0, 1],
          [0.4, 0.2],
          [1, 0.05],
        ])
        .gravity(-4)
        .integrate()
        .alphaOverLife([
          [0, 1],
          [0.7, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "additive", renderOrder: 5 }),
    )
    .build();
}

/** Debris shower — demonstrates MeshRenderer (R2). Small rotating cubes scatter with gravity. */
function debrisDef(): SystemDef {
  // Shared geometry + material: cheap cubes, bright orange unlit
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new MeshBasicNodeMaterial({ color: 0xff8040 });
  return system("debris")
    .duration(4)
    .emitter("chunks", (e) =>
      e
        .capacity(256)
        .duration(0.08)
        .spawnBurst({ time: 0, count: 120 })
        .lifetime({ min: 1.8, max: 3.0 })
        .position({ shape: { kind: "sphere", radius: 0.3, thickness: 1 } })
        .velocity({
          shape: { kind: "cone", angle: Math.PI * 0.35 },
          speed: { min: 3, max: 7 },
        })
        .size({ min: 0.08, max: 0.18 })
        .color([1, 0.6, 0.3], { alpha: 1 })
        .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -6, max: 6 } })
        .integrate()
        .gravity()
        .drag(0.4)
        .renderMesh({ geometry: geom, material: mat }),
    )
    .build();
}

/** Comet trails — ribbon renderer demo (R3). Handful of particles, each leaves a glowing tail. */
function cometTrailsDef(): SystemDef {
  return system("comet_trails")
    .duration(4)
    .emitter("comets", (e) =>
      e
        .capacity(16)
        .duration(0.05)
        .spawnBurst({ time: 0, count: 10 })
        .lifetime({ min: 2.0, max: 3.2 })
        .position({ shape: { kind: "point" } })
        .velocity({
          shape: { kind: "sphere", radius: 1 },
          speed: { min: 2.5, max: 4.5 },
        })
        .size(0.1)
        .color({
          kind: "list",
          values: [
            [3.0, 2.0, 0.5],
            [0.6, 2.2, 2.8],
            [2.8, 1.2, 2.6],
          ],
        })
        .rotation(0)
        .integrate()
        .gravity([0, -1.5, 0])
        .drag(0.15)
        .alphaOverLife([
          [0, 1],
          [0.7, 0.9],
          [1, 0],
        ])
        .renderRibbon({
          historyLength: 36,
          width: 0.18,
          blending: "additive",
          renderOrder: 10,
        }),
    )
    .build();
}

/** Socket-following blade trail — one ribbon head follows a moving Object3D socket. */
function risingFangDef(): SystemDef {
  return system("rising_fang")
    .duration(1.15)
    .trail("blade_ribbon", (trail) =>
      trail
        .capacity(32)
        .sampleRate(72)
        .minDistance(0.025)
        .lifetime(0.46)
        .widthOverLife([
          [0, 0.015],
          [0.18, 0.16],
          [0.62, 0.07],
          [1, 0],
        ])
        .alphaOverLife([
          [0, 0.85],
          [0.12, 1],
          [0.5, 0.55],
          [1, 0],
        ])
        .colorOverLife([
          [0, [1.0, 0.78, 0.32]],
          [0.55, [0.25, 2.8, 4.8]],
          [1, [0.8, 3.8, 5.8]],
        ])
        .renderRibbon({
          blending: "additive",
          depthTest: false,
          faceCamera: true,
          renderOrder: 24,
          layers: [
            { width: 0.22, opacity: 0.28, color: [0.25, 3.5, 5.5] },
            { width: 0.08, opacity: 0.82, color: [5.0, 3.2, 1.2] },
          ],
        }),
    )
    .build();
}

/**
 * Swirling tornado — layered R5 demo. Three emitters sell the funnel:
 *  1. `funnel` — dense, tall column of dust. VortexForce around Y spins it; low-axis
 *     PointAttractor pulls particles inward at the base and releases at the top, carving
 *     the funnel profile. CurlNoiseForce adds organic swirl. Alpha-sorted for depth.
 *  2. `ground_debris` — low-lying dust kicked up at the base; short lifetime.
 *  3. `wispy_top` — faint outer wisps trailing off the top, sell the height.
 */
function tornadoDef(): SystemDef {
  return (
    system("tornado")
      .duration(6)
      // ─── Ground debris: low, fast, fleeting. Spawns in a wide disk and gets sucked in. ───
      .emitter("ground_debris", (e) =>
        e
          .capacity(256)
          .duration(5.5)
          .spawnRate(180)
          .lifetime({ min: 0.6, max: 1.2 })
          .position({ shape: { kind: "disc", radius: 2.2, thickness: 0.9 } })
          .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 0.1, max: 0.6 } })
          .size({ min: 0.08, max: 0.18 })
          .color({ min: [0.38, 0.33, 0.28], max: [0.55, 0.48, 0.4] }, { alpha: 0.7 })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -2.5, max: 2.5 } })
          .integrate()
          // Pulled toward the tornado's base axis.
          .pointAttractor({ position: [0, 0.1, 0], strength: 6, radius: 3, falloff: "linear" })
          // Horizontal swirl; near zero axial lift here.
          .vortex({ axis: [0, 1, 0], origin: [0, 0, 0], strength: 6 })
          .curlNoise({ amplitude: 1.5, frequency: 1.2, speed: 1.0 })
          .drag(0.4)
          .limitVelocity({ maxSpeed: 8, damping: 0.2 })
          .planeCollision({ normal: [0, 1, 0], point: [0, 0, 0], restitution: 0.15, friction: 0.8 })
          .alphaOverLife([
            [0, 0.9],
            [0.3, 1],
            [1, 0],
          ])
          .sizeOverLife([
            [0, 0.8],
            [1, 1.6],
          ])
          .renderSprite({ blending: "alpha", opacity: 0.9, depthWrite: false, renderOrder: 3 }),
      )
      // ─── Main funnel: dense tall column. Carves the tornado silhouette. ─────────────
      .emitter("funnel", (e) =>
        e
          .capacity(1024)
          .duration(5.5)
          .sortByDepth()
          .spawnRate(380)
          // Long lifetimes so particles traverse the full vertical extent.
          .lifetime({ min: 2.0, max: 3.5 })
          // Very narrow seed ring at the base — the funnel widens naturally as particles age.
          .position({ shape: { kind: "ring", radius: 0.35, thickness: 0.6 } })
          .velocity({
            shape: { kind: "cone", angle: Math.PI * 0.08 },
            speed: { min: 0.2, max: 0.8 },
          })
          // Medium-to-large soft smoke billow.
          .size({ min: 0.35, max: 0.65 })
          // Dusty greys with slight warm tint; alpha low so layered billows read softly.
          .color({ min: [0.35, 0.32, 0.3], max: [0.62, 0.55, 0.5] }, { alpha: 0.45 })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -1.2, max: 1.2 } })
          .integrate()
          // Strong lift — funnel rises fast.
          .gravity([0, 3.5, 0])
          // Tangential swirl around the Y-axis; dominant motion.
          .vortex({ axis: [0, 1, 0], origin: [0, 0, 0], strength: 7 })
          // Radial suck toward the axis, falling off with height. Combined with lift this
          // creates the classic funnel profile: tight at the bottom, looser at the top.
          .pointAttractor({ position: [0, 0.5, 0], strength: 5, radius: 4, falloff: "linear" })
          // A second, weaker attractor higher up so the top doesn't flare out.
          .pointAttractor({ position: [0, 4, 0], strength: 2, radius: 5, falloff: "linear" })
          .curlNoise({ amplitude: 1.8, frequency: 0.5, speed: 0.6 })
          .limitVelocity({ maxSpeed: 10, damping: 0.25 })
          .alphaOverLife([
            [0, 0],
            [0.15, 1],
            [0.75, 1],
            [1, 0],
          ])
          .sizeOverLife([
            [0, 0.6],
            [0.5, 1.4],
            [1, 2.2],
          ])
          .colorOverLife([
            { t: 0, color: [0.4, 0.36, 0.32, 1] },
            { t: 0.6, color: [0.55, 0.5, 0.46, 1] },
            { t: 1, color: [0.7, 0.66, 0.62, 1] },
          ])
          .renderSprite({ blending: "alpha", opacity: 1, depthWrite: false, renderOrder: 5 }),
      )
      // ─── Wispy cap: faint fast-moving streamers at the top, give it height and motion. ─
      .emitter("wispy_top", (e) =>
        e
          .capacity(128)
          .duration(5.5)
          .spawnRate(45)
          .lifetime({ min: 1.5, max: 2.5 })
          // Seed these up near the top of the funnel.
          .position({ shape: { kind: "ring", radius: 1.2, thickness: 0.5 } })
          .velocity({
            shape: { kind: "cone", angle: Math.PI * 0.35 },
            speed: { min: 0.8, max: 1.6 },
          })
          .size({ min: 0.5, max: 0.9 })
          .color({ min: [0.55, 0.52, 0.48], max: [0.78, 0.74, 0.7] }, { alpha: 0.28 })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -0.8, max: 0.8 } })
          .integrate()
          .gravity([0, 1.2, 0])
          // Weaker vortex; lets wisps drift outward at the cap.
          .vortex({ axis: [0, 1, 0], origin: [0, 3, 0], strength: 2.5 })
          .curlNoise({ amplitude: 2.0, frequency: 0.4, speed: 0.5 })
          .drag(0.3)
          .alphaOverLife([
            [0, 0],
            [0.25, 1],
            [1, 0],
          ])
          .sizeOverLife([
            [0, 0.8],
            [1, 2.5],
          ])
          .renderSprite({ blending: "alpha", opacity: 0.85, depthWrite: false, renderOrder: 7 }),
      )
      .build()
  );
}

/** Plasma beams — R5 demo for BeamRenderer + ScaleBySpeed. */
function plasmaBeamsDef(): SystemDef {
  return system("plasma_beams")
    .duration(1.0)
    .emitter("beams", (e) =>
      e
        .capacity(32)
        .duration(0.05)
        .spawnBurst({ time: 0, count: 24 })
        .lifetime({ min: 0.6, max: 1.2 })
        .position({ shape: { kind: "sphere", radius: 0.2 } })
        .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 4, max: 8 } })
        .size(1)
        .color(
          {
            kind: "list",
            values: [
              [4.0, 2.0, 6.0],
              [2.0, 4.0, 6.0],
              [6.0, 2.0, 4.0],
            ],
          },
          { alpha: 1 },
        )
        .rotation(0)
        .integrate()
        .drag(0.6)
        .scaleBySpeed({ minSpeed: 0, maxSpeed: 8, minScale: 0.3, maxScale: 1.5 })
        .alphaOverLife([
          [0, 1],
          [0.6, 0.9],
          [1, 0],
        ])
        .renderBeam({ width: 0.15, blending: "additive", taperToTail: true, renderOrder: 10 }),
    )
    .build();
}

/** Ember swarm — R5 demo for LightEmission (illuminates scene) + SphereCollision. */
function emberSwarmDef(): SystemDef {
  return (
    system("ember_swarm")
      .duration(4)
      // Visual embers — sprites.
      .emitter("embers", (e) =>
        e
          .capacity(64)
          .duration(3.5)
          .spawnRate(20)
          .lifetime({ min: 1.5, max: 2.5 })
          .position({ shape: { kind: "sphere", radius: 0.2 } })
          .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 0.5, max: 1.8 } })
          .size({ min: 0.04, max: 0.1 })
          .color({ min: [4, 2, 0.3], max: [5, 3.5, 1.2] }, { alpha: 1 })
          .rotation(0)
          .integrate()
          .gravity([0, 1.5, 0]) // embers rise
          .turbulence({ amplitude: 2.5, frequency: 1.2, speed: 0.8 })
          .drag(0.4)
          .sphereCollision({
            center: [0, 0.5, 0],
            radius: 1.5,
            outside: false, // contain inside the sphere
            restitution: 0.6,
            friction: 0.9,
          })
          .alphaOverLife([
            [0, 1],
            [0.7, 1],
            [1, 0],
          ])
          .renderSprite({ blending: "additive", opacity: 1 }),
      )
      // Ambient lights tracking the first 4 embers — illuminates the ground plane.
      .emitter("embers_light", (e) =>
        e
          .capacity(64)
          .duration(3.5)
          .spawnRate(20)
          .lifetime({ min: 1.5, max: 2.5 })
          .position({ shape: { kind: "sphere", radius: 0.2 } })
          .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 0.5, max: 1.8 } })
          .size(1)
          .color([1, 0.6, 0.2], { alpha: 1 })
          .rotation(0)
          .integrate()
          .gravity([0, 1.5, 0])
          .turbulence({ amplitude: 2.5, frequency: 1.2, speed: 0.8 })
          .drag(0.4)
          .sphereCollision({
            center: [0, 0.5, 0],
            radius: 1.5,
            outside: false,
            restitution: 0.6,
            friction: 0.9,
          })
          .renderLight({ lightCount: 4, color: 0xffa060, intensity: 3, distance: 3, decay: 2 }),
      )
      .build()
  );
}

/**
 * R15 demo — particles bouncing off analytic SDF shapes. The SDF is built from the same
 * `collidableShapes` array that drives the visible meshes, so collisions hit exactly the
 * geometry the user sees. Unlike depth-collision, these bounces work regardless of camera
 * angle — orbit behind anything and drops still collide.
 */
const _sdfDemoSDF = (() => {
  const fns = collidableShapes.map((s) =>
    s.kind === "box" ? sdfBox(s.center, s.halfSize) : sdfSphere(s.center, s.radius),
  );
  // Reduce-with-union gives a single SDF whose surface is the outer hull of every shape.
  return fns.reduce((acc, fn) => (acc ? sdfUnion(acc, fn) : fn));
})();

function sdfBouncerDef(): SystemDef {
  return system("sdf_bouncer")
    .duration(8)
    .emitter("drops", (e) =>
      e
        .capacity(1024)
        .duration(7)
        .loop(true)
        .spawnRate(300)
        .lifetime({ min: 2.0, max: 3.5 })
        .position({ shape: { kind: "box", size: [8, 0.1, 4] } })
        .velocity({ shape: { kind: "point" }, speed: 0 })
        .size({ min: 0.05, max: 0.09 })
        .color([1.8, 0.8, 2.2], { alpha: 1 })
        .rotation({ min: 0, max: Math.PI * 2 })
        .integrate()
        .gravity(-6)
        .sdfCollision({
          sdf: _sdfDemoSDF,
          mode: "bounce",
          restitution: 0.55,
          friction: 0.85,
          thickness: 0.03,
        })
        .drag(0.15)
        .alphaOverLife([
          [0, 1],
          [0.85, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "additive", renderOrder: 5 }),
    )
    .build();
}

/**
 * R9 demo — magical portal. Three stacked emitters:
 *   1. `rim` — surface-sampled torus, bright additive sparks tracing the ring shape.
 *   2. `swirl` — volume-sampled torus tube, deep cyan glow churning inside the ring.
 *   3. `fog`  — disc-shaped alpha fog filling the portal opening, depth-sorted so the layers
 *      compose cleanly instead of popping.
 *
 * Torus is rotated so its axis of symmetry is +Y → the `disc` emission shape (which samples
 * in the XZ plane at y=0) lines up exactly with the portal's opening. Geometry is created
 * once at module scope so `InitFromMesh`'s per-geometry volume-sample cache hits across every
 * factory call.
 */
const _portalTorusGeom = (() => {
  const g = new THREE.TorusGeometry(0.9, 0.32, 24, 48);
  g.rotateX(Math.PI / 2); // align the torus hole with the +Y axis
  return g;
})();
function portalDef(): SystemDef {
  return (
    system("portal")
      .duration(8)
      // ─── Rim: bright sparks tracing the torus surface ──────────────────
      .emitter("rim", (e) =>
        e
          .capacity(512)
          .duration(7.5)
          .spawnRate(260)
          .lifetime({ min: 0.5, max: 1.0 })
          .fromMesh({
            geometry: _portalTorusGeom,
            fill: "surface",
            worldSpace: true,
          })
          .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 0.05, max: 0.35 } })
          .size({ min: 0.05, max: 0.1 })
          .color({ min: [2.0, 4.0, 6.0], max: [3.0, 5.5, 7.5] }, { alpha: 1 })
          .rotation({ min: 0, max: Math.PI * 2 })
          .integrate()
          .drag(2.5)
          .turbulence({ amplitude: 0.8, frequency: 3.0, speed: 1.2 })
          .alphaOverLife([
            [0, 0],
            [0.2, 1],
            [0.75, 0.9],
            [1, 0],
          ])
          .sizeOverLife([
            [0, 1],
            [1, 0.3],
          ])
          .renderSprite({ blending: "additive", renderOrder: 20 }),
      )
      // ─── Swirl: cyan glow churning inside the torus tube ───────────────
      .emitter("swirl", (e) =>
        e
          .capacity(1024)
          .duration(7.5)
          .spawnRate(300)
          .lifetime({ min: 1.4, max: 2.2 })
          .fromMesh({
            geometry: _portalTorusGeom,
            fill: "volume",
            volumeSampleCount: 4096,
            worldSpace: true,
          })
          .velocity({ shape: { kind: "point" }, speed: 0 })
          .size({ min: 0.04, max: 0.09 })
          .color({ min: [0.3, 1.6, 2.8], max: [0.6, 2.2, 3.4] }, { alpha: 1 })
          .rotation({ min: 0, max: Math.PI * 2 })
          .integrate()
          // Gentle vortex around Y so the glow rotates in the plane of the portal.
          .vortex({ axis: [0, 1, 0], origin: [0, 0, 0], strength: 1.2 })
          .turbulence({ amplitude: 0.6, frequency: 2.0, speed: 0.5 })
          .drag(1.8)
          .alphaOverLife([
            [0, 0],
            [0.15, 1],
            [0.8, 1],
            [1, 0],
          ])
          .renderSprite({ blending: "additive", renderOrder: 15 }),
      )
      // ─── Fog: atmospheric haze in the portal opening ───────────────────
      .emitter("fog", (e) =>
        e
          .capacity(256)
          .duration(7.5)
          .sortByDepth()
          .spawnRate(60)
          .lifetime({ min: 1.8, max: 3.0 })
          // Disc fills the inside of the torus ring (torus hole radius ≈ outer − minor ≈ 0.58).
          .position({ shape: { kind: "disc", radius: 0.58, thickness: 1 } })
          .velocity({
            shape: { kind: "cone", angle: Math.PI * 0.5 },
            speed: { min: 0.08, max: 0.25 },
          })
          .size({ min: 0.35, max: 0.65 })
          .color({ min: [0.35, 0.65, 1.1], max: [0.55, 0.85, 1.4] }, { alpha: 0.35 })
          .rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: -0.4, max: 0.4 } })
          .integrate()
          // Same-direction vortex as the swirl so the fog drifts with the portal's rotation.
          .vortex({ axis: [0, 1, 0], origin: [0, 0, 0], strength: 0.8 })
          .curlNoise({ amplitude: 0.3, frequency: 1.2, speed: 0.4 })
          .drag(1.2)
          .alphaOverLife([
            [0, 0],
            [0.3, 1],
            [0.7, 1],
            [1, 0],
          ])
          .sizeOverLife([
            [0, 0.7],
            [0.6, 1.1],
            [1, 1.5],
          ])
          .renderSprite({ blending: "alpha", depthWrite: false, renderOrder: 10 }),
      )
      .build()
  );
}

/**
 * Seeded twin — R13 determinism test. Two copies spawned at symmetric positions MUST look
 * identical (same particle count, same velocities, same sizes, same colors) differing only
 * in position. The preset pins `.seed(1337)`, so every spawn reseeds the RNG to that value
 * on `play()` → both copies call `rng.u32()` in lockstep and get identical per-spawn seeds.
 *
 * Visual check: launch the pair and eyeball them. If they drift apart or look different,
 * determinism is broken.
 */
function seededTwinDef(): SystemDef {
  return system("seeded_twin")
    .duration(2.0)
    .emitter("burst", (e) =>
      e
        .capacity(128)
        .duration(0.02)
        .seed(1337)
        .spawnBurst({ time: 0, count: 100 })
        .lifetime({ min: 1.2, max: 1.8 })
        .position({ shape: { kind: "sphere", radius: 0.1 } })
        .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 2, max: 5 } })
        .size({ min: 0.08, max: 0.16 })
        .color({ min: [2, 0.6, 0.3], max: [3, 1.2, 0.6] }, { alpha: 1 })
        .rotation({ min: 0, max: Math.PI * 2 })
        .integrate()
        .gravity(-5)
        .drag(0.3)
        .alphaOverLife([
          [0, 1],
          [0.8, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "additive", renderOrder: 5 }),
    )
    .build();
}

// ────────────────────────────────────────────────────────────────────────────
// R16 demos — texture & shader hooks. Each preset uses a procedurally generated
// texture (no external assets) so the playground stays self-contained.
// ────────────────────────────────────────────────────────────────────────────

/** Generate an RGBA `DataTexture` from a per-pixel callback. */
function makeDataTexture(
  width: number,
  height: number,
  fill: (x: number, y: number, u: number, v: number) => [number, number, number, number],
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const [r, g, b, a] = fill(x, y, u, v);
      const i = (y * width + x) * 4;
      data[i + 0] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Repeating horizontal stripes of varying intensity, like an electric arc cross-section. */
const _energyBandsTex = makeDataTexture(8, 64, (_x, _y, u, _v) => {
  const bandPhase = u * 6;
  const intensity = 0.4 + 0.6 * Math.abs(Math.sin(bandPhase * Math.PI));
  return [intensity, intensity * 1.1, 1, intensity];
});

/** Smooth value-noise mask used as the `dissolve` threshold in the dissolve sprite. */
const _dissolveNoiseTex = (() => {
  const grid = 8;
  const cells: number[][] = [];
  for (let y = 0; y <= grid; y++) {
    const row: number[] = [];
    for (let x = 0; x <= grid; x++) row.push(Math.random());
    cells.push(row);
  }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return makeDataTexture(64, 64, (_x, _y, u, v) => {
    const gx = u * grid;
    const gy = v * grid;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = smooth(gx - ix);
    const fy = smooth(gy - iy);
    const c00 = cells[iy]![ix]!;
    const c10 = cells[iy]![ix + 1]!;
    const c01 = cells[iy + 1]![ix]!;
    const c11 = cells[iy + 1]![ix + 1]!;
    const top = lerp(c00, c10, fx);
    const bot = lerp(c01, c11, fx);
    const n = lerp(top, bot, fy);
    return [n, n, n, 1];
  });
})();

/**
 * Swirl flowmap — a 2D vector field that rotates around the origin clockwise. R/G channels
 * encode the direction in the standard centered-at-0.5 form.
 */
const _swirlFlowmapTex = makeDataTexture(128, 128, (_x, _y, u, v) => {
  // World-space coords: u, v are in [0,1]; remap to centered [-1, +1].
  const cx = u * 2 - 1;
  const cy = v * 2 - 1;
  // Tangent of a circle around origin → (-y, x), normalized.
  const len = Math.sqrt(cx * cx + cy * cy) || 1;
  const tx = -cy / len;
  const ty = cx / len;
  // Encode [-1, +1] → [0, 1].
  const r = tx * 0.5 + 0.5;
  const g = ty * 0.5 + 0.5;
  return [r, g, 0.5, 1];
});

/**
 * R16 #1 — scrolling-texture energy beam. The base texture is a banded gradient; the
 * `colorNode` scrolls UV.x with `time` so the bands appear to flow along the bolt.
 */
function scrollingBeamDef(): SystemDef {
  return system("scrolling_beam")
    .duration(1.5)
    .emitter("bolts", (e) =>
      e
        .capacity(32)
        .duration(0.05)
        .spawnBurst({ time: 0, count: 16 })
        .lifetime({ min: 0.7, max: 1.3 })
        .position({ shape: { kind: "sphere", radius: 0.15 } })
        .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 5, max: 9 } })
        .size(1)
        .color([3.5, 2.0, 5.5], { alpha: 1 })
        .rotation(0)
        .integrate()
        .drag(0.5)
        .alphaOverLife([
          [0, 1],
          [0.7, 0.9],
          [1, 0],
        ])
        .renderBeam({
          width: 0.18,
          blending: "additive",
          taperToTail: true,
          renderOrder: 12,
          textures: { base: _energyBandsTex },
          colorNode: ({ textures, uv, particle, time }) => {
            // Scroll the band texture along the beam's length (uv.x = 0..1 tail→head).
            const scrolled = scrollUV(uv, vec2(-2.5, 0), time);
            const sample = textures.base.sample(scrolled);
            // Multiply by particle color (HDR magenta) and pump the alpha for additive glow.
            return vec4(sample.rgb.mul(particle.color.rgb), sample.a.mul(particle.color.a));
          },
        }),
    )
    .build();
}

/**
 * R16 #2 — dissolving sprite. Uses two textures: a soft circle (default base) and a noise
 * mask. The custom `colorNode` discards pixels where the noise sample is below the
 * particle's lifetime fraction → the sprite looks like it's burning away from inside out.
 */
function dissolveSpriteDef(): SystemDef {
  return system("dissolve_sprite")
    .duration(3)
    .emitter("flecks", (e) =>
      e
        .capacity(256)
        .duration(2.5)
        .spawnRate(80)
        .lifetime({ min: 1.4, max: 2.4 })
        // Wider spawn area to reduce additive stacking density on the first burst.
        .position({ shape: { kind: "sphere", radius: 0.6 } })
        .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 0.4, max: 1.2 } })
        .size({ min: 0.4, max: 0.7 })
        // All channels stay below the bloom threshold (0.85). The rim glow inside `colorNode`
        // briefly pushes the edge above it for a subtle local hot-pixel pop, but the body
        // never blooms. This kills the "wall of light on spawn" problem when a burst lands
        // on top of itself in additive blend.
        .color({ min: [0.55, 0.28, 0.12], max: [0.75, 0.38, 0.18] }, { alpha: 1 })
        .rotation({ min: 0, max: Math.PI * 2 })
        .integrate()
        .gravity([0, 0.4, 0])
        .drag(0.2)
        // Slower ramp-up — particles ease in over the first 25% of life. Combined with the
        // tame colors, no single moment overpowers.
        .alphaOverLife([
          [0, 0],
          [0.25, 1],
          [1, 1],
        ])
        .renderSprite({
          blending: "additive",
          // Two textures: the soft-circle gives the base SHAPE of each ember (no harsh
          // square edges), the noise mask drives the per-pixel dissolve threshold.
          textures: { base: softCircleTexture(64), mask: _dissolveNoiseTex },
          colorNode: ({ textures, uv, particle }) => {
            const shape = textures.base.sample(uv).a; // soft circle alpha falloff
            const noise = textures.mask.sample(uv).r;
            // Each pixel disappears when `lifetimeT` exceeds its noise value — older
            // particles burn away more pixels each frame, so the sprite dissolves from
            // random spots inward.
            const visible = noise.greaterThan(particle.lifetimeT).select(1, 0);
            // Subtle rim-glow at the dissolve edge — the classic "burning paper" highlight.
            const edge = noise.sub(particle.lifetimeT).abs();
            const rim = edge.lessThan(0.04).select(1.6, 1);
            return vec4(
              particle.color.rgb.mul(rim),
              // Final alpha: base shape × dissolve mask × particle fade-in.
              shape.mul(visible).mul(particle.color.a),
            );
          },
        }),
    )
    .build();
}

/**
 * R16 #3 — flowmap-driven motion. A swirl flowmap nudges every particle's velocity each
 * tick toward the rotational tangent at its (x, z) position, so the cloud rotates as a whole
 * around the y-axis without any explicit force or attractor.
 */
function flowmapParticlesDef(): SystemDef {
  return system("flowmap_particles")
    .duration(8)
    .emitter("dust", (e) =>
      e
        .capacity(512)
        .duration(7.5)
        .spawnRate(150)
        .lifetime({ min: 2.5, max: 4.0 })
        .position({ shape: { kind: "disc", radius: 2.5, thickness: 1 } })
        .velocity({ shape: { kind: "point" }, speed: 0 })
        .size({ min: 0.08, max: 0.16 })
        .color({ min: [0.4, 1.5, 2.5], max: [0.7, 2.0, 3.0] }, { alpha: 1 })
        .rotation({ min: 0, max: Math.PI * 2 })
        .integrate()
        // Flowmap covers a 6×6 world rectangle centered at origin in the XZ plane.
        .flowmapForce({
          texture: _swirlFlowmapTex,
          origin: [-3, 0, -3],
          size: [6, 6],
          axis: "xz",
          amplitude: 4,
        })
        .drag(1.5)
        .alphaOverLife([
          [0, 0],
          [0.2, 1],
          [0.8, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "additive", renderOrder: 6 }),
    )
    .build();
}

manager.register("explosion", explosionDef);
manager.register("smoke_puff", smokePuffDef);
manager.register("magic_orb", magicOrbDef);
manager.register("sparkle_fountain", sparkleFountainDef);
manager.register("debris", debrisDef);
manager.register("comet_trails", cometTrailsDef);
manager.register("rising_fang", risingFangDef);
manager.register("tornado", tornadoDef);
manager.register("plasma_beams", plasmaBeamsDef);
manager.register("ember_swarm", emberSwarmDef);
manager.register("seeded_twin", seededTwinDef);
manager.register("portal", portalDef);
manager.register("sdf_bouncer", sdfBouncerDef);
manager.register("scrolling_beam", scrollingBeamDef);
manager.register("dissolve_sprite", dissolveSpriteDef);
manager.register("flowmap_particles", flowmapParticlesDef);

// Sanity: confirm JSON round-trip produces an equivalent def.
{
  const def = explosionDef();
  const json = systemDefToJSON(def);
  const restored = systemDefFromJSON(json);
  console.info("plume: JSON round-trip OK", { emitters: restored.emitters.length });
}

// Pre-compile every prefab's compute kernels. Without this, the first spawn of a heavy
// emitter (smoke_puff with sortByDepth especially) stalls for seconds while the WebGPU
// driver translates WGSL → MSL/HLSL. Then also pre-pool 49 sparkle fountains because the
// LOD-grid demo spawns that many at once — pool hits avoid a compile storm mid-click.
console.info("plume: warming up compute pipelines...");
void manager
  .warmup()
  .then(() => manager.preload("sparkle_fountain", 49))
  .then(() => console.info("plume: warmup complete"))
  .catch((err: unknown) => console.error("plume: warmup failed", err));

// ────────────────────────────────────────────────────────────────────────────
// UI
// ────────────────────────────────────────────────────────────────────────────

function spawnExplosion(pos = new THREE.Vector3()) {
  manager.spawn("explosion", { position: pos });
}
function spawnSmoke(pos = new THREE.Vector3()) {
  manager.spawn("smoke_puff", { position: pos });
}

document.getElementById("btn-explosion")!.addEventListener("click", () => spawnExplosion());
document
  .getElementById("btn-smoke")!
  .addEventListener("click", () => spawnSmoke(new THREE.Vector3(2, 0, 0)));
document
  .getElementById("btn-orb")!
  .addEventListener("click", () =>
    manager.spawn("magic_orb", { position: new THREE.Vector3(-2, 0, 0) }),
  );
document
  .getElementById("btn-fountain")!
  .addEventListener("click", () =>
    manager.spawn("sparkle_fountain", { position: new THREE.Vector3(0, 0, -2) }),
  );
document
  .getElementById("btn-debris")!
  .addEventListener("click", () =>
    manager.spawn("debris", { position: new THREE.Vector3(0, 0.2, 2) }),
  );
document
  .getElementById("btn-comets")!
  .addEventListener("click", () =>
    manager.spawn("comet_trails", { position: new THREE.Vector3(0, 1.5, 0) }),
  );
document.getElementById("btn-socket-trail")!.addEventListener("click", () => {
  swordSwingStart = performance.now() / 1000;
  manager.spawn("rising_fang", {
    follow: {
      space: "world",
      getPosition: (out) => bladeTip.getWorldPosition(out),
    },
    lod: { bounds: 2.5, farFadeStart: 18, maxDistance: 28 },
  });
});
document
  .getElementById("btn-tornado")!
  .addEventListener("click", () =>
    manager.spawn("tornado", { position: new THREE.Vector3(0, 0, 0) }),
  );
document
  .getElementById("btn-beams")!
  .addEventListener("click", () =>
    manager.spawn("plasma_beams", { position: new THREE.Vector3(0, 1, 0) }),
  );
document
  .getElementById("btn-embers")!
  .addEventListener("click", () =>
    manager.spawn("ember_swarm", { position: new THREE.Vector3(0, 0.5, 0) }),
  );
document.getElementById("btn-dump-shaders")!.addEventListener("click", async () => {
  // Spawn an explosion so we have a live system to interrogate, then dump every shader
  // (compute + render) to the console and also download it as markdown.
  const sys = manager.spawn("explosion", { position: new THREE.Vector3(0, 0, 0) });
  if (!sys) {
    console.warn("plume: could not spawn system for shader dump");
    return;
  }
  // Wait one frame so kernels have been dispatched (their WGSL is cached on first use).
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const dump = await dumpShaders(renderer, sys, { camera, scene });
  const md = dump.markdown();
  console.log(md);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plume-shaders-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  console.info(
    `plume: dumped ${dump.emitters.length} emitter(s) — file downloaded, full text in console`,
  );
});

document.getElementById("btn-mesh-volume")!.addEventListener("click", () => {
  // The portal preset emits in its local frame: torus axis = local +Y, fog disc = local XZ
  // plane. To stand the portal up so its opening faces the camera, we rotate the whole
  // system 90° around local X: that maps local +Y → world +Z (toward the camera).
  const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  manager.spawn("portal", {
    position: new THREE.Vector3(0, 1.5, 0),
    quaternion: standUp,
  });
});

document.getElementById("btn-rain")!.addEventListener("click", () => {
  spawnRainWithSplash(new THREE.Vector3(0, 10, 0));
});

document.getElementById("btn-sdf-bouncer")!.addEventListener("click", () => {
  manager.spawn("sdf_bouncer", { position: new THREE.Vector3(0, 6, 0) });
});

document.getElementById("btn-scrolling-beam")!.addEventListener("click", () => {
  manager.spawn("scrolling_beam", { position: new THREE.Vector3(0, 1.5, 0) });
});
document.getElementById("btn-dissolve-sprite")!.addEventListener("click", () => {
  manager.spawn("dissolve_sprite", { position: new THREE.Vector3(0, 1.5, 0) });
});
document.getElementById("btn-flowmap")!.addEventListener("click", () => {
  manager.spawn("flowmap_particles", { position: new THREE.Vector3(0, 0.5, 0) });
});

// R10 LOD demo — spawn a 7×7 grid of the sparkle fountain preset across a wide area. Each
// one is given a `lod` config that fades intensity to zero past 20 units and culls past
// the frustum. Orbit out and watch distant fountains thin out; pan around and ones behind
// the camera drop to zero cost.
//
// We clear active systems first so every click reuses the 49 pre-warmed pool instances.
// Without this, a second click while the first wave is still alive would allocate 49 fresh
// Systems whose compute pipelines compile mid-frame (the ~100ms rAF stall we saw in R10
// bring-up).
document.getElementById("btn-lod-grid")!.addEventListener("click", () => {
  manager.clear();
  const step = 5;
  const n = 7; // 7×7 = 49 systems
  const half = ((n - 1) * step) / 2;
  let spawned = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * step - half;
      const z = j * step - half;
      const sys = manager.spawn("sparkle_fountain", {
        position: new THREE.Vector3(x, 0, z),
        lod: {
          bounds: 2.5,
          farFadeStart: 10,
          maxDistance: 20,
        },
      });
      if (sys) spawned++;
    }
  }
  console.info(`plume: spawned ${spawned} LOD-gated fountains — orbit to see fade/culling`);
});

document.getElementById("btn-seeded-twin")!.addEventListener("click", () => {
  // Spawn two copies of the seeded preset at symmetric positions on the same tick. With
  // determinism working, both bursts should look identical — same particle count, same
  // velocities, same sizes, same colors — offset only by world position. If they don't
  // match, R13's seed wiring is broken.
  manager.spawn("seeded_twin", { position: new THREE.Vector3(-1.5, 1, 0) });
  manager.spawn("seeded_twin", { position: new THREE.Vector3(+1.5, 1, 0) });
  console.info(
    "plume: seeded-twin test — the two bursts should look identical (same count, speeds, colors).",
  );
});
document.getElementById("btn-clear")!.addEventListener("click", () => manager.clear());

// ────────────────────────────────────────────────────────────────────────────
// Fireworks — demonstrates the events system (R1).
// Rocket emitter fires with `onDeath` events enabled. A burst emitter listens to
// those events via SpawnFromEvents — each rocket-death spawns a burst of particles
// at the death location. This can't live in a SystemDef preset because the burst
// needs a constructed Emitter reference, so we manage it ad-hoc.
// ────────────────────────────────────────────────────────────────────────────

interface FireworkPair {
  group: THREE.Group;
  rocket: Emitter;
  burst: Emitter;
  worldMatrix: THREE.Matrix4;
}

const activeFireworks: FireworkPair[] = [];

function spawnFireworks(origin: THREE.Vector3): void {
  // Authored with the fluent builder. The rocket emitter emits onDeath events; the burst
  // emitter consumes them via SpawnFromEvents, which requires a reference to the rocket
  // instance — that's why this uses `new Emitter(builder.build())` instead of a prefab
  // SystemDef (prefabs don't have cross-emitter references by design).
  const rocket = new Emitter(
    emitter("firework_rocket")
      .capacity(16)
      .duration(0.05) // fire exactly one particle burst then stop spawning
      .emitEvents({ onDeath: true, capacity: 16 })
      .spawnBurst({ time: 0, count: 1 })
      .lifetime({ min: 1.0, max: 1.4 })
      .position({ shape: { kind: "point" } })
      .velocity({ shape: { kind: "cone", angle: Math.PI * 0.05 }, speed: { min: 6, max: 9 } })
      .size(0.2)
      .color([2.4, 2.0, 1.0], { alpha: 1 }) // bright yellow trail
      .rotation(0)
      .integrate()
      .gravity(-4)
      .drag(0.2)
      .alphaOverLife([
        [0, 1],
        [0.9, 1],
        [1, 0],
      ])
      .renderSprite({ blending: "additive", renderOrder: 5 })
      .build(),
  );

  const burstColors: [number, number, number][] = [
    [3.0, 1.2, 0.8],
    [0.8, 2.0, 3.0],
    [2.5, 2.5, 0.8],
    [2.2, 0.6, 2.4],
  ];
  const pick = burstColors[Math.floor(Math.random() * burstColors.length)]!;

  const burst = new Emitter(
    emitter("firework_burst")
      .capacity(2048)
      .spawnFromEvents(rocket, 180, 2)
      // NO .position — position inherited from the event
      .lifetime({ min: 0.8, max: 1.6 })
      .velocity({ shape: { kind: "sphere", radius: 1 }, speed: { min: 2, max: 7 } })
      .size({ min: 0.12, max: 0.28 })
      .color(pick, { alpha: 1 })
      .rotation({ min: 0, max: Math.PI * 2 })
      .integrate()
      .gravity(-3)
      .drag(0.8)
      .alphaOverLife([
        [0, 1],
        [0.6, 0.8],
        [1, 0],
      ])
      .sizeOverLife([
        [0, 1],
        [1, 0.4],
      ])
      .renderSprite({ blending: "additive", renderOrder: 6 })
      .build(),
  );

  const group = new THREE.Group();
  group.add(rocket.render.object3D);
  group.add(burst.render.object3D);
  scene.add(group);

  const worldMatrix = new THREE.Matrix4().setPosition(origin);
  activeFireworks.push({ group, rocket, burst, worldMatrix });
}

document.getElementById("btn-firework")!.addEventListener("click", () => {
  const x = (Math.random() - 0.5) * 6;
  const z = (Math.random() - 0.5) * 6;
  spawnFireworks(new THREE.Vector3(x, 0, z));
});

// ────────────────────────────────────────────────────────────────────────────
// Rain + splash — R11 demo. Rain emitter uses DepthCollision in "kill" mode; each kill
// emits an onDeath event carrying the impact position. A splash emitter consumes those
// events via SpawnFromEvents and bursts 6 tiny droplets per impact — reads as a real
// raindrop-hitting-surface splatter. Like fireworks, this needs direct Emitter instances
// because the splash emitter holds a reference to the rain one.
// ────────────────────────────────────────────────────────────────────────────

interface RainPair {
  group: THREE.Group;
  rain: Emitter;
  splash: Emitter;
  worldMatrix: THREE.Matrix4;
}
const activeRain: RainPair[] = [];

function spawnRainWithSplash(origin: THREE.Vector3): void {
  const rain = new Emitter(
    emitter("rain")
      .capacity(1024)
      .duration(12)
      .loop(true)
      // Emit an event each time a drop dies — DepthCollision in `kill` mode will trigger
      // these on impact, carrying the particle's world position.
      .emitEvents({ onDeath: true, capacity: 256 })
      .spawnRate(500)
      .lifetime({ min: 2.5, max: 4.0 })
      .position({ shape: { kind: "box", size: [12, 0.2, 12] } })
      .velocity({ shape: { kind: "point" }, speed: 0 })
      .size({ min: 0.03, max: 0.06 })
      .color([0.5, 0.8, 1.6], { alpha: 0.9 })
      .rotation(0)
      .integrate()
      .gravity(-8)
      .depthCollision({
        depthTexture,
        camera,
        mode: "kill", // die on impact — the splash emitter takes over visually
        thickness: 0.0008,
      })
      .limitVelocity({ maxSpeed: 12, damping: 1 })
      .alphaOverLife([
        [0, 0.9],
        [0.85, 0.9],
        [1, 0],
      ])
      .renderSprite({ blending: "additive", renderOrder: 5 })
      .build(),
  );

  const splash = new Emitter(
    emitter("splash")
      .capacity(2048)
      .spawnFromEvents(rain, 6, 128) // 6 micro-droplets per impact, up to 128 impacts/frame
      // NO .position — inherited from the event's impact point
      .lifetime({ min: 0.25, max: 0.45 })
      .velocity({
        shape: { kind: "cone", angle: Math.PI * 0.45 }, // spray upward in a cone
        speed: { min: 1.5, max: 3.5 },
      })
      .size({ min: 0.02, max: 0.04 })
      .color([0.6, 0.9, 1.8], { alpha: 1 })
      .rotation(0)
      .integrate()
      .gravity(-12)
      .drag(3)
      .alphaOverLife([
        [0, 1],
        [0.6, 1],
        [1, 0],
      ])
      .sizeOverLife([
        [0, 1],
        [1, 0.3],
      ])
      .renderSprite({ blending: "additive", renderOrder: 6 })
      .build(),
  );

  const group = new THREE.Group();
  group.add(rain.render.object3D);
  group.add(splash.render.object3D);
  scene.add(group);
  const worldMatrix = new THREE.Matrix4().setPosition(origin);
  activeRain.push({ group, rain, splash, worldMatrix });
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    spawnExplosion();
  }
});

// (Click-in-scene-to-explode disabled — use the HUD buttons instead. Kept the import path
// clean in case we want to reinstate it for the editor's ad-hoc spawn workflow later.)

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  // Depth target tracks canvas size — DepthCollision samples at screen-space UVs so the
  // target must match the active viewport dimensions.
  depthRT.setSize(window.innerWidth, window.innerHeight);
  depthTexture.image.width = window.innerWidth;
  depthTexture.image.height = window.innerHeight;
});

// ────────────────────────────────────────────────────────────────────────────
// Render loop
// ────────────────────────────────────────────────────────────────────────────

const timer = new Timer();
timer.connect(document);
let frameCount = 0;
let fpsAcc = 0;

function tick(timestamp?: number) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 1 / 30);
  controls.update();
  updateSwordRig(performance.now() / 1000);

  // Depth pre-pass: render the collidables-only scene into `depthRT` BEFORE `manager.tick()`
  // so `DepthCollision` samples this frame's depth (not last frame's). Restoring target=null
  // hands control back to the main RenderPipeline below.
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(depthRT);
  renderer.clear();
  renderer.render(depthScene, camera);
  renderer.setRenderTarget(prevTarget);

  manager.tick(dt, camera);

  // Tick ad-hoc fireworks — source BEFORE listener so listener reads same-frame events.
  for (let i = activeFireworks.length - 1; i >= 0; i--) {
    const fw = activeFireworks[i]!;
    fw.rocket.tick(renderer, dt, fw.worldMatrix, 1);
    fw.burst.tick(renderer, dt, fw.worldMatrix, 1);
    fw.rocket.syncRender({ camera, worldMatrix: fw.worldMatrix, intensity: 1 });
    fw.burst.syncRender({ camera, worldMatrix: fw.worldMatrix, intensity: 1 });
    // Very rough lifetime — clean up after ~5s
    if (!fw.rocket.isAlive() && !fw.burst.isAlive()) {
      scene.remove(fw.group);
      fw.rocket.dispose();
      fw.burst.dispose();
      activeFireworks.splice(i, 1);
    }
  }

  // Tick ad-hoc rain + splash — rain first so splash reads its events same-frame. Rain
  // needs `camera` threaded through for DepthCollision's beforeUpdate hook.
  for (let i = activeRain.length - 1; i >= 0; i--) {
    const rp = activeRain[i]!;
    rp.rain.tick(renderer, dt, rp.worldMatrix, 1, camera);
    rp.splash.tick(renderer, dt, rp.worldMatrix, 1, camera);
    rp.rain.syncRender({ camera, worldMatrix: rp.worldMatrix, intensity: 1 });
    rp.splash.syncRender({ camera, worldMatrix: rp.worldMatrix, intensity: 1 });
    if (!rp.rain.isAlive() && !rp.splash.isAlive()) {
      scene.remove(rp.group);
      rp.rain.dispose();
      rp.splash.dispose();
      activeRain.splice(i, 1);
    }
  }

  renderPipeline.render();

  fpsAcc += dt;
  frameCount++;
  if (fpsAcc >= 0.25) {
    const fps = frameCount / fpsAcc;
    statsEl.textContent = `${fps.toFixed(0)} fps`;
    fpsAcc = 0;
    frameCount = 0;
  }

  requestAnimationFrame(tick);
}

tick();
