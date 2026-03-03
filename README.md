# PF2E Inventory + Shop (Owlbear Rodeo Extension)

Pathfinder 2E inventory/shop extension with per-character persistence, GM controls, NPC profile cards, and a Markdown-based item compendium.

## Implemented features

- Per-character coins/inventory persisted in Owlbear room metadata.
- GM mode for viewing/editing all PCs and NPCs.
- GM player-mapping UI for linking PCs to connected players.
- NPC profile cards that players can open from the NPC directory.
- NPC card can open into shop only if `NPC has shop` is enabled.
- Character hero layout with **large portrait overlay** and **faded banner bottom**.
- Shop + inventory item type icons (emoji by default) with optional per-item icon image URL override.
- Local demo fallback mode (for standalone dev outside Owlbear) after a short timeout.
- Repo-based compendium under `compendium/items/*.md` with in-app “Add to Active Shop”.

## Compendium format

Each item is a Markdown file:

```md
name: Longsword
type: weapon
price_cp: 1000
bulk: 1
icon: ⚔️
image:
```

`type` supports: `weapon`, `armor`, `consumable`, `gear`, `treasure`, `tool`.

## Development

```bash
npm install
npm run dev
npm run build
```
