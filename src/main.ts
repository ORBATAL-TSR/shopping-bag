import OBR, { Metadata } from "@owlbear-rodeo/sdk";
import "./styles.css";

type CoinPouch = {
  gp: number;
  sp: number;
  cp: number;
};

type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  unitPriceCp: number;
  bulk: number;
};

type Character = {
  id: string;
  name: string;
  isNpc: boolean;
  linkedPlayerId: string | null;
  profileImage: string;
  coins: CoinPouch;
  inventory: InventoryItem[];
  canActAsShop: boolean;
  shopHeaderImage: string;
};

type Shop = {
  headerImage: string;
  inventory: InventoryItem[];
};

type AppState = {
  characters: Record<string, Character>;
  globalShop: Shop;
  selectedCharacterId: string | null;
  selectedShopId: string;
};

const METADATA_KEY = "com.example.pf2e-shop/state";
const GLOBAL_SHOP_ID = "global-shop";

const STARTING_SHOP: InventoryItem[] = [
  { id: crypto.randomUUID(), name: "Healing Potion (Minor)", quantity: 5, unitPriceCp: 400, bulk: 0.1 },
  { id: crypto.randomUUID(), name: "Rope (50 ft)", quantity: 10, unitPriceCp: 10, bulk: 1 },
  { id: crypto.randomUUID(), name: "Torch", quantity: 20, unitPriceCp: 1, bulk: 0 },
];

let userId = "local";
let state: AppState = {
  characters: {},
  globalShop: {
    headerImage: "",
    inventory: [...STARTING_SHOP],
  },
  selectedCharacterId: null,
  selectedShopId: GLOBAL_SHOP_ID,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App container missing");

app.innerHTML = `
  <h1>PF2E Character Inventory + Shops</h1>
  <div class="subtitle">Per-character inventory/coins, optional player sync, NPC shops, and shop imagery.</div>

  <section class="panel">
    <h2>Characters</h2>
    <div class="grid" id="character-controls"></div>
    <div class="list" id="character-summary"></div>
  </section>

  <section class="panel">
    <div class="row"><h2>Active Character</h2><span id="total-bulk" class="badge"></span></div>
    <div id="character-profile"></div>
    <div class="grid" id="coins-grid"></div>
    <div class="grid" id="inventory-form"></div>
    <div class="list" id="inventory-list"></div>
  </section>

  <section class="panel">
    <h2>Shop</h2>
    <div class="grid" id="shop-controls"></div>
    <div id="shop-header"></div>
    <div class="grid" id="shop-form"></div>
    <div class="list" id="shop-list"></div>
  </section>

  <div class="message" id="message"></div>
`;

const characterControls = document.getElementById("character-controls")!;
const characterSummary = document.getElementById("character-summary")!;
const characterProfile = document.getElementById("character-profile")!;
const coinsGrid = document.getElementById("coins-grid")!;
const inventoryForm = document.getElementById("inventory-form")!;
const inventoryList = document.getElementById("inventory-list")!;
const shopControls = document.getElementById("shop-controls")!;
const shopHeader = document.getElementById("shop-header")!;
const shopForm = document.getElementById("shop-form")!;
const shopList = document.getElementById("shop-list")!;
const messageEl = document.getElementById("message")!;
const totalBulkEl = document.getElementById("total-bulk")!;

function coinToCp(coins: CoinPouch): number {
  return coins.gp * 100 + coins.sp * 10 + coins.cp;
}

function cpToCoin(totalCp: number): CoinPouch {
  const bounded = Math.max(0, Math.floor(totalCp));
  const gp = Math.floor(bounded / 100);
  const sp = Math.floor((bounded % 100) / 10);
  const cp = bounded % 10;
  return { gp, sp, cp };
}

function formatCoins(cp: number): string {
  const coins = cpToCoin(cp);
  return `${coins.gp} gp ${coins.sp} sp ${coins.cp} cp`;
}

function setMessage(text: string, isError = false) {
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#fca5a5" : "#86efac";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCharacters(): Character[] {
  return Object.values(state.characters);
}

function getActiveCharacter(): Character | null {
  if (!state.selectedCharacterId) return null;
  return state.characters[state.selectedCharacterId] ?? null;
}

function getShopInventoryById(shopId: string): InventoryItem[] {
  if (shopId === GLOBAL_SHOP_ID) return state.globalShop.inventory;
  return state.characters[shopId]?.inventory ?? [];
}

function isNpcShop(shopId: string): boolean {
  return shopId !== GLOBAL_SHOP_ID;
}

function getShopHeaderImage(shopId: string): string {
  if (shopId === GLOBAL_SHOP_ID) return state.globalShop.headerImage;
  return state.characters[shopId]?.shopHeaderImage ?? "";
}

function upsertInventoryItem(inventory: InventoryItem[], item: Omit<InventoryItem, "id">) {
  const existing = inventory.find((entry) => entry.name === item.name && entry.unitPriceCp === item.unitPriceCp);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    inventory.push({ id: crypto.randomUUID(), ...item });
  }
}

function ensureState() {
  const chars = getCharacters();
  if (chars.length === 0) {
    const defaultCharacter: Character = {
      id: crypto.randomUUID(),
      name: "New Hero",
      isNpc: false,
      linkedPlayerId: userId,
      profileImage: "",
      coins: { gp: 15, sp: 0, cp: 0 },
      inventory: [],
      canActAsShop: false,
      shopHeaderImage: "",
    };
    state.characters[defaultCharacter.id] = defaultCharacter;
    state.selectedCharacterId = defaultCharacter.id;
  }

  if (!state.selectedCharacterId || !state.characters[state.selectedCharacterId]) {
    const linked = getCharacters().find((character) => character.linkedPlayerId === userId);
    state.selectedCharacterId = linked?.id ?? getCharacters()[0].id;
  }

  if (state.selectedShopId !== GLOBAL_SHOP_ID) {
    const shopCharacter = state.characters[state.selectedShopId];
    if (!shopCharacter || !shopCharacter.isNpc || !shopCharacter.canActAsShop) {
      state.selectedShopId = GLOBAL_SHOP_ID;
    }
  }
}

async function saveState() {
  await OBR.room.setMetadata({ [METADATA_KEY]: state });
}

function readState(metadata: Metadata) {
  const metadataState = metadata[METADATA_KEY];
  if (metadataState && typeof metadataState === "object") {
    state = metadataState as AppState;
  }
  ensureState();
}

function render() {
  const activeCharacter = getActiveCharacter();
  const characters = getCharacters();
  const npcShops = characters.filter((character) => character.isNpc && character.canActAsShop);

  characterControls.innerHTML = `
    <label>Active Character
      <select id="selected-character">
        ${characters
          .map(
            (character) =>
              `<option value="${character.id}" ${character.id === state.selectedCharacterId ? "selected" : ""}>${escapeHtml(
                character.name,
              )}${character.isNpc ? " (NPC)" : ""}</option>`,
          )
          .join("")}
      </select>
    </label>
    <input id="new-character-name" placeholder="New character name" />
    <label class="check"><input id="new-character-is-npc" type="checkbox" /> NPC</label>
    <input id="new-character-profile" placeholder="Profile image URL" />
    <button id="create-character">Create Character</button>
    <button id="delete-character" class="secondary">Delete Selected</button>
    <input id="link-player-id" placeholder="Linked player id (optional)" value="${escapeHtml(
      activeCharacter?.linkedPlayerId ?? "",
    )}" />
    <button id="link-current-player" class="secondary">Sync to Connected Player</button>
  `;

  characterSummary.innerHTML = characters
    .map((character) => {
      const linkLabel = character.linkedPlayerId ? `Linked: ${character.linkedPlayerId}` : "Not linked";
      return `<div class="item">
        <div class="row"><strong>${escapeHtml(character.name)}</strong><span class="badge">${
          character.isNpc ? "NPC" : "PC"
        }</span></div>
        <div>${linkLabel}</div>
      </div>`;
    })
    .join("");

  if (!activeCharacter) {
    characterProfile.innerHTML = "<div class='item'>No active character selected.</div>";
    coinsGrid.innerHTML = "";
    inventoryForm.innerHTML = "";
    inventoryList.innerHTML = "";
    return;
  }

  const totalBulk = activeCharacter.inventory.reduce((sum, item) => sum + item.bulk * item.quantity, 0);
  totalBulkEl.textContent = `Bulk ${totalBulk.toFixed(1)}`;

  characterProfile.innerHTML = `
    <div class="profile-card">
      ${
        activeCharacter.profileImage
          ? `<img src="${escapeHtml(activeCharacter.profileImage)}" class="profile-image" alt="character profile" />`
          : '<div class="image-placeholder">No profile image</div>'
      }
      <div>
        <div><strong>${escapeHtml(activeCharacter.name)}</strong></div>
        <div>${activeCharacter.isNpc ? "NPC" : "Player Character"}</div>
        <label class="check"><input id="active-character-shop-toggle" type="checkbox" ${
          activeCharacter.canActAsShop ? "checked" : ""
        } ${activeCharacter.isNpc ? "" : "disabled"}/> NPC can act as shop</label>
        <input id="active-character-profile" placeholder="Profile image URL" value="${escapeHtml(
          activeCharacter.profileImage,
        )}" />
        <input id="active-character-shop-header" placeholder="NPC shop header image URL" value="${escapeHtml(
          activeCharacter.shopHeaderImage,
        )}" ${activeCharacter.isNpc ? "" : "disabled"} />
        <button id="save-character-images">Save Character Images</button>
      </div>
    </div>
  `;

  coinsGrid.innerHTML = `
    <label>GP <input id="coin-gp" type="number" min="0" value="${activeCharacter.coins.gp}" /></label>
    <label>SP <input id="coin-sp" type="number" min="0" value="${activeCharacter.coins.sp}" /></label>
    <label>CP <input id="coin-cp" type="number" min="0" value="${activeCharacter.coins.cp}" /></label>
    <button id="save-coins">Save Coins</button>
  `;

  inventoryForm.innerHTML = `
    <input id="inv-name" placeholder="Item name" />
    <input id="inv-qty" type="number" min="1" value="1" placeholder="Qty" />
    <input id="inv-price" type="number" min="0" value="0" placeholder="Price (cp)" />
    <input id="inv-bulk" type="number" min="0" step="0.1" value="0" placeholder="Bulk" />
    <button id="add-inv">Add Inventory Item</button>
  `;

  inventoryList.innerHTML = activeCharacter.inventory
    .map(
      (item) => `<div class="item">
        <div class="row">
          <strong>${escapeHtml(item.name)}</strong>
          <button class="secondary" data-sell-id="${item.id}">Sell 1 (half value)</button>
        </div>
        <div>${item.quantity} × ${formatCoins(item.unitPriceCp)} | Bulk ${item.bulk}</div>
      </div>`,
    )
    .join("");

  shopControls.innerHTML = `
    <label>Active Shop
      <select id="selected-shop">
        <option value="${GLOBAL_SHOP_ID}" ${state.selectedShopId === GLOBAL_SHOP_ID ? "selected" : ""}>Global Shop</option>
        ${npcShops
          .map(
            (npc) =>
              `<option value="${npc.id}" ${npc.id === state.selectedShopId ? "selected" : ""}>${escapeHtml(
                npc.name,
              )} (NPC Shop)</option>`,
          )
          .join("")}
      </select>
    </label>
    <input id="shop-header-image" placeholder="Shop header image URL" value="${escapeHtml(
      getShopHeaderImage(state.selectedShopId),
    )}" />
    <button id="save-shop-header">Save Shop Header</button>
  `;

  const headerImage = getShopHeaderImage(state.selectedShopId);
  shopHeader.innerHTML = `<div class="shop-header">${
    headerImage ? `<img src="${escapeHtml(headerImage)}" class="shop-header-image" alt="shop header" />` : "No shop header image"
  }</div>`;

  shopForm.innerHTML = `
    <input id="shop-name" placeholder="Shop item" />
    <input id="shop-stock" type="number" min="1" value="1" placeholder="Stock" />
    <input id="shop-price" type="number" min="0" value="0" placeholder="Price (cp)" />
    <input id="shop-bulk" type="number" min="0" step="0.1" value="0" placeholder="Bulk" />
    <button id="add-shop">Add Shop Item</button>
  `;

  const activeShopInventory = getShopInventoryById(state.selectedShopId);
  shopList.innerHTML = activeShopInventory
    .map(
      (item) => `<div class="item">
      <div class="row">
        <strong>${escapeHtml(item.name)}</strong>
        <button data-buy-id="${item.id}">Buy 1</button>
      </div>
      <div>Stock ${item.quantity} | ${formatCoins(item.unitPriceCp)} | Bulk ${item.bulk}</div>
    </div>`,
    )
    .join("");

  bindEvents();
}

function bindEvents() {
  document.getElementById("selected-character")?.addEventListener("change", async (event) => {
    const target = event.target as HTMLSelectElement;
    state.selectedCharacterId = target.value;
    await saveState();
    render();
  });

  document.getElementById("create-character")?.addEventListener("click", async () => {
    const name = (document.getElementById("new-character-name") as HTMLInputElement).value.trim();
    const isNpc = (document.getElementById("new-character-is-npc") as HTMLInputElement).checked;
    const profileImage = (document.getElementById("new-character-profile") as HTMLInputElement).value.trim();
    if (!name) return setMessage("Character name is required.", true);

    const newCharacter: Character = {
      id: crypto.randomUUID(),
      name,
      isNpc,
      linkedPlayerId: isNpc ? null : userId,
      profileImage,
      coins: { gp: 15, sp: 0, cp: 0 },
      inventory: [],
      canActAsShop: false,
      shopHeaderImage: "",
    };

    state.characters[newCharacter.id] = newCharacter;
    state.selectedCharacterId = newCharacter.id;
    await saveState();
    setMessage(`${name} created.`);
    render();
  });

  document.getElementById("delete-character")?.addEventListener("click", async () => {
    if (!state.selectedCharacterId) return;
    const id = state.selectedCharacterId;
    const name = state.characters[id]?.name ?? "Character";
    delete state.characters[id];
    state.selectedCharacterId = null;
    ensureState();
    await saveState();
    setMessage(`${name} deleted.`);
    render();
  });

  document.getElementById("link-current-player")?.addEventListener("click", async () => {
    const activeCharacter = getActiveCharacter();
    if (!activeCharacter) return;

    const linkPlayerIdInput = document.getElementById("link-player-id") as HTMLInputElement;
    const manualPlayerId = linkPlayerIdInput.value.trim();
    activeCharacter.linkedPlayerId = manualPlayerId || userId;

    await saveState();
    setMessage(`${activeCharacter.name} linked to player ${activeCharacter.linkedPlayerId}.`);
    render();
  });

  document.getElementById("save-character-images")?.addEventListener("click", async () => {
    const activeCharacter = getActiveCharacter();
    if (!activeCharacter) return;

    activeCharacter.profileImage = (document.getElementById("active-character-profile") as HTMLInputElement).value.trim();
    activeCharacter.canActAsShop = (document.getElementById("active-character-shop-toggle") as HTMLInputElement).checked;
    activeCharacter.shopHeaderImage = (document.getElementById("active-character-shop-header") as HTMLInputElement).value.trim();

    if (!activeCharacter.isNpc) {
      activeCharacter.canActAsShop = false;
      activeCharacter.shopHeaderImage = "";
    }

    if (!activeCharacter.canActAsShop && state.selectedShopId === activeCharacter.id) {
      state.selectedShopId = GLOBAL_SHOP_ID;
    }

    await saveState();
    setMessage(`Updated profile/shop settings for ${activeCharacter.name}.`);
    render();
  });

  document.getElementById("save-coins")?.addEventListener("click", async () => {
    const activeCharacter = getActiveCharacter();
    if (!activeCharacter) return;

    const gp = Number((document.getElementById("coin-gp") as HTMLInputElement).value);
    const sp = Number((document.getElementById("coin-sp") as HTMLInputElement).value);
    const cp = Number((document.getElementById("coin-cp") as HTMLInputElement).value);

    activeCharacter.coins = {
      gp: Math.max(0, gp),
      sp: Math.max(0, sp),
      cp: Math.max(0, cp),
    };

    await saveState();
    setMessage(`Updated coins for ${activeCharacter.name}.`);
    render();
  });

  document.getElementById("add-inv")?.addEventListener("click", async () => {
    const activeCharacter = getActiveCharacter();
    if (!activeCharacter) return;

    const name = (document.getElementById("inv-name") as HTMLInputElement).value.trim();
    const quantity = Number((document.getElementById("inv-qty") as HTMLInputElement).value);
    const unitPriceCp = Number((document.getElementById("inv-price") as HTMLInputElement).value);
    const bulk = Number((document.getElementById("inv-bulk") as HTMLInputElement).value);

    if (!name) return setMessage("Inventory item name is required.", true);

    upsertInventoryItem(activeCharacter.inventory, {
      name,
      quantity: Math.max(1, quantity),
      unitPriceCp: Math.max(0, unitPriceCp),
      bulk: Math.max(0, bulk),
    });

    await saveState();
    setMessage(`Added ${name} to ${activeCharacter.name}.`);
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sell-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const activeCharacter = getActiveCharacter();
      if (!activeCharacter) return;

      const itemId = button.dataset.sellId;
      if (!itemId) return;

      const item = activeCharacter.inventory.find((entry) => entry.id === itemId);
      if (!item) return;

      item.quantity -= 1;
      if (item.quantity <= 0) {
        activeCharacter.inventory = activeCharacter.inventory.filter((entry) => entry.id !== itemId);
      }

      const sellValue = Math.floor(item.unitPriceCp / 2);
      activeCharacter.coins = cpToCoin(coinToCp(activeCharacter.coins) + sellValue);

      const destinationShopInventory = getShopInventoryById(state.selectedShopId);
      upsertInventoryItem(destinationShopInventory, {
        name: item.name,
        quantity: 1,
        unitPriceCp: item.unitPriceCp,
        bulk: item.bulk,
      });

      await saveState();
      setMessage(`Sold 1 ${item.name} for ${formatCoins(sellValue)}.`);
      render();
    });
  });

  document.getElementById("selected-shop")?.addEventListener("change", async (event) => {
    const target = event.target as HTMLSelectElement;
    state.selectedShopId = target.value;
    await saveState();
    render();
  });

  document.getElementById("save-shop-header")?.addEventListener("click", async () => {
    const headerImage = (document.getElementById("shop-header-image") as HTMLInputElement).value.trim();
    if (isNpcShop(state.selectedShopId)) {
      const npc = state.characters[state.selectedShopId];
      if (npc) {
        npc.shopHeaderImage = headerImage;
      }
    } else {
      state.globalShop.headerImage = headerImage;
    }

    await saveState();
    setMessage("Shop header image updated.");
    render();
  });

  document.getElementById("add-shop")?.addEventListener("click", async () => {
    const name = (document.getElementById("shop-name") as HTMLInputElement).value.trim();
    const quantity = Number((document.getElementById("shop-stock") as HTMLInputElement).value);
    const unitPriceCp = Number((document.getElementById("shop-price") as HTMLInputElement).value);
    const bulk = Number((document.getElementById("shop-bulk") as HTMLInputElement).value);
    if (!name) return setMessage("Shop item name is required.", true);

    const inventory = getShopInventoryById(state.selectedShopId);
    upsertInventoryItem(inventory, {
      name,
      quantity: Math.max(1, quantity),
      unitPriceCp: Math.max(0, unitPriceCp),
      bulk: Math.max(0, bulk),
    });

    await saveState();
    setMessage(`Added ${name} to the active shop.`);
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-buy-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const activeCharacter = getActiveCharacter();
      if (!activeCharacter) return;

      const itemId = button.dataset.buyId;
      if (!itemId) return;

      const inventory = getShopInventoryById(state.selectedShopId);
      const shopItem = inventory.find((entry) => entry.id === itemId);
      if (!shopItem || shopItem.quantity < 1) {
        return setMessage("That item is out of stock.", true);
      }

      const wallet = coinToCp(activeCharacter.coins);
      if (wallet < shopItem.unitPriceCp) {
        return setMessage("Not enough coins for that purchase.", true);
      }

      shopItem.quantity -= 1;
      if (shopItem.quantity <= 0) {
        const index = inventory.findIndex((entry) => entry.id === itemId);
        inventory.splice(index, 1);
      }

      activeCharacter.coins = cpToCoin(wallet - shopItem.unitPriceCp);
      upsertInventoryItem(activeCharacter.inventory, {
        name: shopItem.name,
        quantity: 1,
        unitPriceCp: shopItem.unitPriceCp,
        bulk: shopItem.bulk,
      });

      await saveState();
      setMessage(`${activeCharacter.name} bought 1 ${shopItem.name}.`);
      render();
    });
  });
}

async function init() {
  await OBR.onReady(async () => {
    userId = OBR.player.id;
    const metadata = await OBR.room.getMetadata();
    readState(metadata);

    OBR.room.onMetadataChange((nextMetadata) => {
      readState(nextMetadata);
      render();
    });

    render();
    setMessage("Connected to Owlbear room metadata.");
  });
}

init();
