<script lang="ts">
  /**
   * Left-rail palette: every NodeSpec, grouped by category. Click adds a node at a
   * default canvas position. We skip the `emitter` category because the compiler
   * enforces exactly-one and the starter graph already has it; users delete-and-readd
   * indirectly by editing fields on the existing one.
   */
  import { NODE_SPECS, type Category } from "../builder/nodes.js";
  import { addNode } from "./graphStore.svelte.js";

  const categoryOrder: Category[] = ["emitter", "spawn", "init", "update", "render"];
  const categoryLabel: Record<Category, string> = {
    emitter: "Emitter",
    spawn: "Spawn",
    init: "Init",
    update: "Update",
    render: "Render",
  };

  const grouped = categoryOrder.map((cat) => ({
    cat,
    specs: NODE_SPECS.filter((s) => s.category === cat),
  }));
</script>

<aside class="palette">
  <h2>Modules</h2>
  {#each grouped as group (group.cat)}
    <section>
      <h3>{categoryLabel[group.cat]}</h3>
      <ul>
        {#each group.specs as spec (spec.type)}
          <li>
            <button
              type="button"
              style="--accent: {spec.accent};"
              onclick={() => addNode(spec.type)}
              title={`Add ${spec.label}`}
            >
              {spec.label}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</aside>

<style>
  .palette {
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    background: #14161b;
    border-right: 1px solid #2a2c33;
    color: #e7e7e9;
    font: 13px/1.3 system-ui, sans-serif;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #9ae6b4;
  }
  h3 {
    margin: 14px 0 6px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #888;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  button {
    width: 100%;
    text-align: left;
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-left: 3px solid var(--accent);
    border-radius: 5px;
    padding: 6px 10px;
    cursor: pointer;
    font: inherit;
    transition: background 0.1s;
  }
  button:hover {
    background: #242832;
  }
</style>
