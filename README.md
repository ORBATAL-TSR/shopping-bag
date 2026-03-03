# PF2E Character Inventory + Shop (Owlbear Rodeo Extension)

A lightweight Owlbear Rodeo extension panel for Pathfinder 2E with per-character inventory and currency, plus global and NPC-driven shops.

## Features

- Per-character GP/SP/CP and inventory persistence (instead of per-player-only buckets).
- Optional character-to-connected-player sync via linked player ID.
- NPCs with inventory that can be toggled into fully usable shops.
- Global shop and NPC shops support custom header image URLs.
- Character profile image URL for each character.
- Buy/sell economy helpers:
  - Buy from active shop at listed value.
  - Sell from active character inventory at half value into active shop stock.
- Data persisted to Owlbear room metadata.

## Getting started

```bash
npm install
npm run dev
```

Then load the extension URL in Owlbear Rodeo's extension manager.

## Build

```bash
npm run build
```
