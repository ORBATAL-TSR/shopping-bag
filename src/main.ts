import OBR, { Metadata } from "@owlbear-rodeo/sdk";
import "./styles.css";

type CoinPouch = { gp: number; sp: number; cp: number };
type ItemType = "weapon" | "armor" | "consumable" | "gear" | "treasure" | "tool";

type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  unitPriceCp: number;
  bulk: number;
  itemType: ItemType;
  iconOverrideUrl?: string;
};

type Character = {
  id: string;
  name: string;
  isNpc: boolean;
  linkedPlayerId: string | null;
  profileImage: string;
  bannerImage: string;
  bio: string;
  coins: CoinPouch;
  inventory: InventoryItem[];
  canActAsShop: boolean;
  shopHeaderImage: string;
};

type Shop = { headerImage: string; inventory: InventoryItem[] };

type AppState = {
  characters: Record<string, Character>;
  globalShop: Shop;
  selectedCharacterId: string | null;
  selectedShopId: string;
};

type PartyPlayer = { id: string; name: string; role: "GM" | "PLAYER" };
type CompendiumItem = {
  slug: string;
  name: string;
  type: ItemType;
  priceCp: number;
  bulk: number;
  icon: string;
  image?: string;
};

const METADATA_KEY = "com.example.pf2e-shop/state";
const GLOBAL_SHOP_ID = "global-shop";

const ITEM_TYPE_ICON: Record<ItemType, string> = {
  weapon: "⚔️",
  armor: "🛡️",
  consumable: "🧪",
  gear: "🎒",
  treasure: "💰",
  tool: "🧰",
};

const STARTING_SHOP: InventoryItem[] = [
  { id: crypto.randomUUID(), name: "Healing Potion (Minor)", quantity: 5, unitPriceCp: 400, bulk: 0.1, itemType: "consumable" },
  { id: crypto.randomUUID(), name: "Rope (50 ft)", quantity: 10, unitPriceCp: 10, bulk: 1, itemType: "gear" },
  { id: crypto.randomUUID(), name: "Torch", quantity: 20, unitPriceCp: 1, bulk: 0, itemType: "gear" },
];

let userId = "local";
let userRole: "GM" | "PLAYER" = "PLAYER";
let gmModeEnabled = false;
let partyPlayers: PartyPlayer[] = [];
let npcModalCharacterId: string | null = null;

let state: AppState = {
  characters: {},
  globalShop: { headerImage: "", inventory: [...STARTING_SHOP] },
  selectedCharacterId: null,
  selectedShopId: GLOBAL_SHOP_ID,
};

const rawCompendium = import.meta.glob("../compendium/items/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const compendium = Object.entries(rawCompendium)
  .map(([path, markdown]) => parseCompendiumFile(path, markdown))
  .filter((item): item is CompendiumItem => Boolean(item))
  .sort((a, b) => a.name.localeCompare(b.name));

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App container missing");

app.innerHTML = `
  <div class="frame">
    <h1>🧺 PF2E Inventory + Shop</h1>
    <div class="subtitle">Resizable Owlbear panel layout • GM mode supports all-character editing.</div>

    <section class="panel compact-note">
      <strong>🧭 Panel note:</strong> Owlbear extensions are framed/draggable by Owlbear itself. This UI is responsive for narrow widths.
    </section>

    <section class="panel">
      <h2>Characters</h2>
      <div class="grid" id="character-controls"></div>
      <div class="list" id="character-summary"></div>
      <div class="list" id="npc-directory"></div>
    </section>

    <section class="panel">
      <div class="row"><h2>Active Character</h2><span id="total-bulk" class="badge"></span></div>
      <div id="character-hero"></div>
      <div class="grid" id="coins-grid"></div>
      <div class="grid" id="inventory-form"></div>
      <div class="list" id="inventory-list"></div>
    </section>

    <section class="panel">
      <h2>Shop</h2>
      <div class="grid" id="shop-controls"></div>
      <div id="shop-header"></div>
      <div class="grid" id="shop-form"></div>
      <div class="grid" id="compendium-add"></div>
      <div class="list" id="shop-list"></div>
    </section>

    <div class="message" id="message"></div>
  </div>

  <div id="npc-modal" class="modal hidden"></div>
`;

const characterControls = document.getElementById("character-controls")!;
const characterSummary = document.getElementById("character-summary")!;
const npcDirectory = document.getElementById("npc-directory")!;
const characterHero = document.getElementById("character-hero")!;
const coinsGrid = document.getElementById("coins-grid")!;
const inventoryForm = document.getElementById("inventory-form")!;
const inventoryList = document.getElementById("inventory-list")!;
const shopControls = document.getElementById("shop-controls")!;
const shopHeader = document.getElementById("shop-header")!;
const shopForm = document.getElementById("shop-form")!;
const compendiumAdd = document.getElementById("compendium-add")!;
const shopList = document.getElementById("shop-list")!;
const messageEl = document.getElementById("message")!;
const totalBulkEl = document.getElementById("total-bulk")!;
const npcModal = document.getElementById("npc-modal")!;

function parseCompendiumFile(path: string, markdown: string): CompendiumItem | null {
  const lines = markdown.split("\n");
  const take = (key: string): string => lines.find((line) => line.startsWith(`${key}:`))?.split(":")[1]?.trim() ?? "";
  const name = take("name");
  const type = take("type") as ItemType;
  if (!name || !type || !(type in ITEM_TYPE_ICON)) return null;
  return {
    slug: path.split("/").pop()!.replace(".md", ""),
    name,
    type,
    priceCp: Number(take("price_cp") || "0"),
    bulk: Number(take("bulk") || "0"),
    icon: take("icon") || ITEM_TYPE_ICON[type],
    image: take("image") || undefined,
  };
}

function coinToCp(c: CoinPouch) { return c.gp * 100 + c.sp * 10 + c.cp; }
function cpToCoin(totalCp: number): CoinPouch {
  const v = Math.max(0, Math.floor(totalCp));
  return { gp: Math.floor(v / 100), sp: Math.floor((v % 100) / 10), cp: v % 10 };
}
function formatCoins(cp: number) { const c = cpToCoin(cp); return `${c.gp} gp ${c.sp} sp ${c.cp} cp`; }
function setMessage(text: string, isError = false) { messageEl.textContent = text; messageEl.style.color = isError ? "#fca5a5" : "#86efac"; }
function escapeHtml(v: string) { return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function getCharacters() { return Object.values(state.characters); }
function canUseGmMode() { return userRole === "GM"; }
function isGmModeActive() { return canUseGmMode() && gmModeEnabled; }
function canEditCharacter(character: Character) { return isGmModeActive() || (!character.isNpc && character.linkedPlayerId === userId); }
function getActiveCharacter() { return state.selectedCharacterId ? state.characters[state.selectedCharacterId] ?? null : null; }
function getShopInventoryById(shopId: string) { return shopId === GLOBAL_SHOP_ID ? state.globalShop.inventory : state.characters[shopId]?.inventory ?? []; }
function getShopHeaderImage(shopId: string) { return shopId === GLOBAL_SHOP_ID ? state.globalShop.headerImage : state.characters[shopId]?.shopHeaderImage ?? ""; }

function upsertInventoryItem(inventory: InventoryItem[], item: Omit<InventoryItem, "id">) {
  const existing = inventory.find((x) => x.name === item.name && x.unitPriceCp === item.unitPriceCp);
  if (existing) existing.quantity += item.quantity;
  else inventory.push({ id: crypto.randomUUID(), ...item });
}

function ensureState() {
  if (getCharacters().length === 0) {
    const c: Character = {
      id: crypto.randomUUID(), name: "New Hero", isNpc: false, linkedPlayerId: userId,
      profileImage: "", bannerImage: "", bio: "", coins: { gp: 15, sp: 0, cp: 0 }, inventory: [], canActAsShop: false, shopHeaderImage: "",
    };
    state.characters[c.id] = c;
    state.selectedCharacterId = c.id;
  }
  if (!state.selectedCharacterId || !state.characters[state.selectedCharacterId]) state.selectedCharacterId = getCharacters()[0].id;
}

async function saveState() { await OBR.room.setMetadata({ [METADATA_KEY]: state }); }
function readState(metadata: Metadata) {
  const s = metadata[METADATA_KEY];
  if (s && typeof s === "object") state = s as AppState;
  for (const c of Object.values(state.characters)) {
    c.bannerImage ??= "";
    c.bio ??= "";
  }
  ensureState();
}

function renderNpcModal() {
  if (!npcModalCharacterId) {
    npcModal.classList.add("hidden");
    npcModal.innerHTML = "";
    return;
  }
  const npc = state.characters[npcModalCharacterId];
  if (!npc) return;
  const canOpenShop = npc.canActAsShop;
  npcModal.classList.remove("hidden");
  npcModal.innerHTML = `
    <div class="modal-backdrop" data-close-npc-modal="1"></div>
    <div class="modal-card">
      <button class="modal-close" data-close-npc-modal="1">✕</button>
      <div class="hero-banner" style="background-image:url('${escapeHtml(npc.bannerImage || npc.shopHeaderImage)}')">
        <div class="hero-fade"></div>
        ${npc.profileImage ? `<img class="hero-portrait" src="${escapeHtml(npc.profileImage)}" alt="npc"/>` : ""}
      </div>
      <h3>${escapeHtml(npc.name)}</h3>
      <p>${escapeHtml(npc.bio || "No biography set.")}</p>
      ${canOpenShop ? `<button id="open-npc-shop">🛒 Open ${escapeHtml(npc.name)} Shop</button>` : `<div class="muted">No shop available.</div>`}
    </div>
  `;

  document.querySelectorAll("[data-close-npc-modal]").forEach((el) => el.addEventListener("click", () => { npcModalCharacterId = null; renderNpcModal(); }));
  document.getElementById("open-npc-shop")?.addEventListener("click", async () => {
    state.selectedShopId = npc.id;
    npcModalCharacterId = null;
    await saveState();
    render();
  });
}

function render() {
  const chars = getCharacters();
  const active = getActiveCharacter();
  const editable = active ? canEditCharacter(active) : false;
  const npcShops = chars.filter((c) => c.isNpc && c.canActAsShop);

  characterControls.innerHTML = `
    ${canUseGmMode() ? `<label class="check gm-mode"><input id="gm-mode-toggle" type="checkbox" ${isGmModeActive() ? "checked" : ""}/> GM mode</label>` : ""}
    <label>Active Character<select id="selected-character">${chars
      .map((c) => `<option value="${c.id}" ${c.id === state.selectedCharacterId ? "selected" : ""}>${escapeHtml(c.name)}${c.isNpc ? " (NPC)" : ""}</option>`)
      .join("")}</select></label>
    <input id="new-character-name" placeholder="New character name" />
    <label class="check"><input id="new-character-is-npc" type="checkbox"/> NPC</label>
    <button id="create-character">Create Character</button>
    <button id="delete-character" class="secondary" ${editable ? "" : "disabled"}>Delete Selected</button>
    <label>Linked player<select id="link-player-id" ${active?.isNpc ? "disabled" : ""}>
      <option value="">Unlinked</option>
      ${partyPlayers.map((p) => `<option value="${p.id}" ${active?.linkedPlayerId === p.id ? "selected" : ""}>${escapeHtml(p.name)} (${p.role})</option>`).join("")}
    </select></label>
    <button id="save-link" class="secondary" ${editable ? "" : "disabled"}>Save Player Mapping</button>
  `;

  characterSummary.innerHTML = chars
    .map((c) => `<div class="item"><div class="row"><strong>${escapeHtml(c.name)}</strong><span class="badge">${c.isNpc ? "NPC" : "PC"}</span></div><div>${c.isNpc ? "NPC" : `Linked: ${partyPlayers.find((p) => p.id === c.linkedPlayerId)?.name ?? (c.linkedPlayerId ?? "Unlinked")}`}</div></div>`)
    .join("");

  const npcs = chars.filter((c) => c.isNpc);
  npcDirectory.innerHTML = `<h3>NPC Directory</h3>${npcs
    .map((npc) => `<div class="item row"><div>${escapeHtml(npc.name)} ${npc.canActAsShop ? "🛒" : ""}</div><button data-open-npc="${npc.id}">View Card</button></div>`)
    .join("")}`;

  if (!active) return;

  totalBulkEl.textContent = `Bulk ${active.inventory.reduce((sum, i) => sum + i.quantity * i.bulk, 0).toFixed(1)}`;
  characterHero.innerHTML = `
    <div class="hero-banner" style="background-image:url('${escapeHtml(active.bannerImage || active.shopHeaderImage)}')">
      <div class="hero-fade"></div>
      ${active.profileImage ? `<img class="hero-portrait" src="${escapeHtml(active.profileImage)}" alt="character"/>` : ""}
    </div>
    <div class="hero-meta">
      <strong>${escapeHtml(active.name)}</strong>
      <textarea id="active-bio" placeholder="Character/NPC description" ${editable ? "" : "disabled"}>${escapeHtml(active.bio)}</textarea>
      <div class="grid cols-3">
        <input id="active-profile" placeholder="Profile image URL" value="${escapeHtml(active.profileImage)}" ${editable ? "" : "disabled"}/>
        <input id="active-banner" placeholder="Banner image URL" value="${escapeHtml(active.bannerImage)}" ${editable ? "" : "disabled"}/>
        <input id="active-shop-header" placeholder="Shop header URL" value="${escapeHtml(active.shopHeaderImage)}" ${editable ? "" : "disabled"}/>
      </div>
      <label class="check"><input id="active-npc-shop" type="checkbox" ${active.canActAsShop ? "checked" : ""} ${active.isNpc && editable ? "" : "disabled"}/> NPC has shop</label>
      <button id="save-character-media" ${editable ? "" : "disabled"}>Save Character Card</button>
    </div>
  `;

  coinsGrid.innerHTML = `
    <label>GP <input id="coin-gp" type="number" min="0" value="${active.coins.gp}"/></label>
    <label>SP <input id="coin-sp" type="number" min="0" value="${active.coins.sp}"/></label>
    <label>CP <input id="coin-cp" type="number" min="0" value="${active.coins.cp}"/></label>
    <button id="save-coins" ${editable ? "" : "disabled"}>Save Coins</button>
  `;

  inventoryForm.innerHTML = `
    <input id="inv-name" placeholder="Item name"/>
    <input id="inv-qty" type="number" min="1" value="1"/>
    <input id="inv-price" type="number" min="0" value="0" placeholder="Price cp"/>
    <input id="inv-bulk" type="number" min="0" step="0.1" value="0" placeholder="Bulk"/>
    <select id="inv-type">${Object.keys(ITEM_TYPE_ICON).map((t) => `<option value="${t}">${ITEM_TYPE_ICON[t as ItemType]} ${t}</option>`).join("")}</select>
    <input id="inv-icon-url" placeholder="Optional icon image URL"/>
    <button id="add-inv" ${editable ? "" : "disabled"}>Add Inventory Item</button>
  `;

  inventoryList.innerHTML = active.inventory.map((it) => `<div class="item"><div class="row"><strong>${it.iconOverrideUrl ? `<img class='tiny-icon' src='${escapeHtml(it.iconOverrideUrl)}'/>` : ITEM_TYPE_ICON[it.itemType]} ${escapeHtml(it.name)}</strong><button data-sell-id="${it.id}" class="secondary" ${editable ? "" : "disabled"}>Sell 1</button></div><div>${it.quantity} × ${formatCoins(it.unitPriceCp)} | Bulk ${it.bulk}</div></div>`).join("");

  shopControls.innerHTML = `
    <label>Active Shop<select id="selected-shop"><option value="${GLOBAL_SHOP_ID}" ${state.selectedShopId === GLOBAL_SHOP_ID ? "selected" : ""}>Global Shop</option>${npcShops.map((n) => `<option value="${n.id}" ${state.selectedShopId === n.id ? "selected" : ""}>${escapeHtml(n.name)} Shop</option>`).join("")}</select></label>
    <input id="shop-header-image" placeholder="Shop header image URL" value="${escapeHtml(getShopHeaderImage(state.selectedShopId))}"/>
    <button id="save-shop-header" ${isGmModeActive() ? "" : "disabled"}>Save Shop Header</button>
  `;

  const headerImage = getShopHeaderImage(state.selectedShopId);
  shopHeader.innerHTML = `<div class="shop-header">${headerImage ? `<img src="${escapeHtml(headerImage)}" class="shop-header-image" alt="shop"/>` : "No shop header image"}</div>`;

  shopForm.innerHTML = `
    <input id="shop-name" placeholder="Shop item"/>
    <input id="shop-stock" type="number" min="1" value="1"/>
    <input id="shop-price" type="number" min="0" value="0" placeholder="Price cp"/>
    <input id="shop-bulk" type="number" min="0" step="0.1" value="0" placeholder="Bulk"/>
    <select id="shop-type">${Object.keys(ITEM_TYPE_ICON).map((t) => `<option value="${t}">${ITEM_TYPE_ICON[t as ItemType]} ${t}</option>`).join("")}</select>
    <input id="shop-icon-url" placeholder="Optional icon image URL"/>
    <button id="add-shop" ${isGmModeActive() ? "" : "disabled"}>Add Shop Item</button>
  `;

  compendiumAdd.innerHTML = `
    <label>Compendium Item<select id="compendium-item-id">${compendium.map((c) => `<option value="${c.slug}">${c.icon} ${escapeHtml(c.name)} (${formatCoins(c.priceCp)})</option>`).join("")}</select></label>
    <input id="compendium-qty" type="number" min="1" value="1"/>
    <button id="add-compendium-to-shop" ${isGmModeActive() ? "" : "disabled"}>Add to Active Shop</button>
  `;

  const shopInv = getShopInventoryById(state.selectedShopId);
  shopList.innerHTML = shopInv.map((it) => `<div class="item"><div class="row"><strong>${it.iconOverrideUrl ? `<img class='tiny-icon' src='${escapeHtml(it.iconOverrideUrl)}'/>` : ITEM_TYPE_ICON[it.itemType]} ${escapeHtml(it.name)}</strong><button data-buy-id="${it.id}" ${editable ? "" : "disabled"}>Buy 1</button></div><div>Stock ${it.quantity} | ${formatCoins(it.unitPriceCp)} | Bulk ${it.bulk}</div></div>`).join("");

  bindEvents();
  renderNpcModal();
}

function bindEvents() {
  document.getElementById("gm-mode-toggle")?.addEventListener("change", () => { gmModeEnabled = (document.getElementById("gm-mode-toggle") as HTMLInputElement).checked; render(); });
  document.getElementById("selected-character")?.addEventListener("change", async (e) => { state.selectedCharacterId = (e.target as HTMLSelectElement).value; await saveState(); render(); });

  document.getElementById("create-character")?.addEventListener("click", async () => {
    const name = (document.getElementById("new-character-name") as HTMLInputElement).value.trim();
    const isNpc = (document.getElementById("new-character-is-npc") as HTMLInputElement).checked;
    if (!name) return setMessage("Character name required.", true);
    if (isNpc && !isGmModeActive()) return setMessage("Only GM mode can create NPCs.", true);
    const c: Character = {
      id: crypto.randomUUID(), name, isNpc, linkedPlayerId: isNpc ? null : userId,
      profileImage: "", bannerImage: "", bio: "", coins: { gp: 15, sp: 0, cp: 0 }, inventory: [], canActAsShop: false, shopHeaderImage: "",
    };
    state.characters[c.id] = c;
    state.selectedCharacterId = c.id;
    await saveState();
    render();
  });

  document.getElementById("delete-character")?.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    if (!state.selectedCharacterId) return;
    delete state.characters[state.selectedCharacterId];
    state.selectedCharacterId = null;
    ensureState();
    await saveState();
    render();
  });

  document.getElementById("save-link")?.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || active.isNpc || !canEditCharacter(active)) return setMessage("No permission.", true);
    active.linkedPlayerId = (document.getElementById("link-player-id") as HTMLSelectElement).value || null;
    await saveState();
    setMessage("Player mapping saved.");
    render();
  });

  document.getElementById("save-character-media")?.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    active.profileImage = (document.getElementById("active-profile") as HTMLInputElement).value.trim();
    active.bannerImage = (document.getElementById("active-banner") as HTMLInputElement).value.trim();
    active.shopHeaderImage = (document.getElementById("active-shop-header") as HTMLInputElement).value.trim();
    active.bio = (document.getElementById("active-bio") as HTMLTextAreaElement).value.trim();
    active.canActAsShop = (document.getElementById("active-npc-shop") as HTMLInputElement).checked;
    if (!active.isNpc) active.canActAsShop = false;
    await saveState();
    render();
  });

  document.getElementById("save-coins")?.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    active.coins = {
      gp: Math.max(0, Number((document.getElementById("coin-gp") as HTMLInputElement).value)),
      sp: Math.max(0, Number((document.getElementById("coin-sp") as HTMLInputElement).value)),
      cp: Math.max(0, Number((document.getElementById("coin-cp") as HTMLInputElement).value)),
    };
    await saveState();
    setMessage("Coins updated.");
    render();
  });

  document.getElementById("add-inv")?.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    const name = (document.getElementById("inv-name") as HTMLInputElement).value.trim();
    if (!name) return setMessage("Item name required.", true);
    upsertInventoryItem(active.inventory, {
      name,
      quantity: Math.max(1, Number((document.getElementById("inv-qty") as HTMLInputElement).value)),
      unitPriceCp: Math.max(0, Number((document.getElementById("inv-price") as HTMLInputElement).value)),
      bulk: Math.max(0, Number((document.getElementById("inv-bulk") as HTMLInputElement).value)),
      itemType: (document.getElementById("inv-type") as HTMLSelectElement).value as ItemType,
      iconOverrideUrl: (document.getElementById("inv-icon-url") as HTMLInputElement).value.trim() || undefined,
    });
    await saveState();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sell-id]").forEach((btn) => btn.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    const item = active.inventory.find((i) => i.id === btn.dataset.sellId);
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) active.inventory = active.inventory.filter((i) => i.id !== item.id);
    const sellValue = Math.floor(item.unitPriceCp / 2);
    active.coins = cpToCoin(coinToCp(active.coins) + sellValue);
    upsertInventoryItem(getShopInventoryById(state.selectedShopId), { ...item, quantity: 1 });
    await saveState();
    render();
  }));

  document.getElementById("selected-shop")?.addEventListener("change", async (e) => { state.selectedShopId = (e.target as HTMLSelectElement).value; await saveState(); render(); });
  document.getElementById("save-shop-header")?.addEventListener("click", async () => {
    if (!isGmModeActive()) return setMessage("GM mode required.", true);
    const image = (document.getElementById("shop-header-image") as HTMLInputElement).value.trim();
    if (state.selectedShopId === GLOBAL_SHOP_ID) state.globalShop.headerImage = image;
    else if (state.characters[state.selectedShopId]) state.characters[state.selectedShopId].shopHeaderImage = image;
    await saveState(); render();
  });

  document.getElementById("add-shop")?.addEventListener("click", async () => {
    if (!isGmModeActive()) return setMessage("GM mode required.", true);
    const name = (document.getElementById("shop-name") as HTMLInputElement).value.trim();
    if (!name) return setMessage("Item name required.", true);
    upsertInventoryItem(getShopInventoryById(state.selectedShopId), {
      name,
      quantity: Math.max(1, Number((document.getElementById("shop-stock") as HTMLInputElement).value)),
      unitPriceCp: Math.max(0, Number((document.getElementById("shop-price") as HTMLInputElement).value)),
      bulk: Math.max(0, Number((document.getElementById("shop-bulk") as HTMLInputElement).value)),
      itemType: (document.getElementById("shop-type") as HTMLSelectElement).value as ItemType,
      iconOverrideUrl: (document.getElementById("shop-icon-url") as HTMLInputElement).value.trim() || undefined,
    });
    await saveState(); render();
  });

  document.getElementById("add-compendium-to-shop")?.addEventListener("click", async () => {
    if (!isGmModeActive()) return setMessage("GM mode required.", true);
    const slug = (document.getElementById("compendium-item-id") as HTMLSelectElement).value;
    const item = compendium.find((c) => c.slug === slug);
    if (!item) return;
    const qty = Math.max(1, Number((document.getElementById("compendium-qty") as HTMLInputElement).value));
    upsertInventoryItem(getShopInventoryById(state.selectedShopId), {
      name: item.name,
      quantity: qty,
      unitPriceCp: item.priceCp,
      bulk: item.bulk,
      itemType: item.type,
      iconOverrideUrl: item.image,
    });
    await saveState();
    setMessage(`Added ${qty}× ${item.name} from compendium.`);
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-buy-id]").forEach((btn) => btn.addEventListener("click", async () => {
    const active = getActiveCharacter();
    if (!active || !canEditCharacter(active)) return setMessage("No permission.", true);
    const inv = getShopInventoryById(state.selectedShopId);
    const item = inv.find((i) => i.id === btn.dataset.buyId);
    if (!item || item.quantity < 1) return;
    const wallet = coinToCp(active.coins);
    if (wallet < item.unitPriceCp) return setMessage("Not enough coins.", true);
    item.quantity -= 1;
    if (item.quantity <= 0) inv.splice(inv.findIndex((i) => i.id === item.id), 1);
    active.coins = cpToCoin(wallet - item.unitPriceCp);
    upsertInventoryItem(active.inventory, { ...item, quantity: 1 });
    await saveState();
    render();
  }));

  document.querySelectorAll<HTMLButtonElement>("[data-open-npc]").forEach((btn) => btn.addEventListener("click", () => {
    npcModalCharacterId = btn.dataset.openNpc ?? null;
    renderNpcModal();
  }));
}

async function init() {
  let initialized = false;
  const demo = () => {
    if (initialized) return;
    initialized = true;
    userRole = "GM";
    gmModeEnabled = true;
    ensureState();
    render();
    setMessage("Local demo mode active.");
  };
  const timeout = window.setTimeout(demo, 1200);

  await OBR.onReady(async () => {
    if (initialized) return;
    initialized = true;
    window.clearTimeout(timeout);

    userId = OBR.player.id;
    userRole = await OBR.player.getRole();
    partyPlayers = (await OBR.party.getPlayers()).map((p) => ({ id: p.id, name: p.name, role: p.role }));
    readState(await OBR.room.getMetadata());

    OBR.room.onMetadataChange((m) => { readState(m); render(); });
    OBR.party.onChange((players) => { partyPlayers = players.map((p) => ({ id: p.id, name: p.name, role: p.role })); render(); });
    OBR.player.onChange((p) => { userRole = p.role; if (!canUseGmMode()) gmModeEnabled = false; render(); });

    ensureState();
    render();
    setMessage("Connected to Owlbear room metadata.");
  });
}

init();
