Hooks.on("renderCharacterSheetPF2e", (app, html) => {
  const actor = app.actor;
  if (actor?.type !== "character") return;
  if (!actor.canUserModify(game.user, "update")) return;
  if (html.find(".hlo-importer-btn").length) return;

  const btn = $(`<a class="header-button hlo-importer-btn" title="Import HLO JSON">
    <i class="fas fa-file-import"></i> HLO
  </a>`);

  btn.on("click", () => beginHLOLocalImport(app.object));
  html.closest(".app").find(".window-header .title").after(btn);
});

async function beginHLOLocalImport(targetActor) {
  let apply = false;
  new Dialog({
    title: "Herolab Online Import (Local JSON)",
    content: `
      <p>Paste your <b>HLO character JSON</b> (the whole file) below.</p>
      <textarea style="width:100%;height:260px" placeholder="{ ... }"></textarea>
    `,
    buttons: {
      import: { label: "Import", callback: () => apply = true },
      cancel: { label: "Cancel" }
    },
    default: "import",
    close: async (html) => {
      if (!apply) return;
      const raw = html.find("textarea").val();
      let hlo;
      try { hlo = JSON.parse(raw); }
      catch (e) { console.error(e); return ui.notifications.error("Invalid JSON."); }
      try {
        const doc = await buildFoundryDocFromHLO(hlo);
        await applyFoundryDocToActor(doc, targetActor);
        ui.notifications.info("HLO import complete.");
      } catch (e) {
        console.error(e);
        ui.notifications.error("Conversion failed (see console).");
      }
    }
  }).render(true);
}

function featTypeFromHlo(it) {
  const t = (it.Trait || "").toLowerCase();
  if (t.includes("ankitsune")) return "ancestry";
  if (t.includes("cl")) return "class";
  if (t.includes("trtskill")) return "skill";
  if (t.includes("trtgeneral")) return "general";
  return "general";
}
const cap = s => (s||"").charAt(0).toUpperCase() + (s||"").slice(1);
const abil = (items, code) => {
  const it = Object.values(items).find(i => (i.key||"").startsWith(code));
  const v = Number(it?.stNet ?? 10);
  return Number.isFinite(v) ? v : 10;
};

async function buildFoundryDocFromHLO(hlo) {
  const actors = hlo.actors || {};
  const h = actors[Object.keys(actors)[0]];
  if (!h) throw new Error("No actor found in HLO JSON.");

  const items = h.items || {};
  const gv = h.gameValues || {};
  const level = Number(gv.actLevelNet ?? 1);
  const langs = Object.values(items)
    .filter(i => (i.key||"").startsWith("ln"))
    .map(i => (i.name||"").toLowerCase())
    .filter(Boolean);
  const hpIt = Object.values(items).find(i => (i.key||"").startsWith("rvHitPoints"));
  const hpMax = Number(hpIt?.rvMax ?? 10);
  const spIt = Object.values(items).find(i => (i.key||"").startsWith("mvSpeed"));
  const speed = Number(spIt?.stNet ?? 25);

  const ancestryName = cap(gv.actRace || "Kitsune");

  const doc = {
    name: h.name || "Converted Character",
    type: "character",
    system: {
      details: {
        level: { value: level },
        keyability: { value: "cha" },
        languages: { value: langs, details: "" },
        biography: { appearance: "", backstory: "Imported from HLO." },
        alliance: "party"
      },
      abilities: {
        str: { value: abil(items,"asStr") },
        dex: { value: abil(items,"asDex") },
        con: { value: abil(items,"asCon") },
        int: { value: abil(items,"asInt") },
        wis: { value: abil(items,"asWis") },
        cha: { value: abil(items,"asCha") }
      },
      attributes: {
        hp: { value: hpMax, max: hpMax, temp: 0 },
        speed: { value: speed },
        initiative: { statistic: "perception" },
        heroPoints: { value: 1, max: 3 }
      }
    },
    items: []
  };

  // Ancestry / Heritage / Background / Class
  doc.items.push({
    name: ancestryName, type: "ancestry",
    img: "systems/pf2e/icons/default-icons/ancestry.svg",
    system: { traits: { rarity: { value: "uncommon" }, value: ["humanoid", (gv.actRace||"").toLowerCase()] },
              hp: 8, speed, size: "medium" }
  });

  const heritage = Object.values(items).find(i => i.compset === "Heritage");
  if (heritage) doc.items.push({
    name: heritage.name, type: "heritage",
    img: "systems/pf2e/icons/default-icons/heritage.svg",
    system: { traits: { rarity: { value: "common" }, value: [(gv.actRace||"").toLowerCase()] },
              ancestry: { name: ancestryName } }
  });

  if (gv.actBackgroundText) {
    doc.items.push({
      name: gv.actBackgroundText, type: "background",
      img: "systems/pf2e/icons/default-icons/background.svg",
      system: { traits: { rarity: "common", value: [] } }
    });
    if (/tech\s+delver/i.test(gv.actBackgroundText)) {
      doc.items.push({ name: "Drift Lore", type: "lore",
        img: "systems/pf2e/icons/default-icons/lore.svg",
        system: { proficient: { value: 1 }, mod: { value: 0 } }});
      doc.items.push({ name: "Computers Lore", type: "lore",
        img: "systems/pf2e/icons/default-icons/lore.svg",
        system: { proficient: { value: 1 }, mod: { value: 0 } }});
    }
  }

  const cls = (gv.actClassText || "Envoy 1");
  const clsName = cap(cls.split(/\s+/)[0]);
  doc.items.push({
    name: clsName, type: "class",
    img: "systems/pf2e/icons/default-icons/class.svg",
    system: {
      level: { value: level },
      keyAbility: { value: "cha" },
      hpPerLevel: 8,
      perception: { value: 1 },
      savingThrows: { fortitude: { value: 1 }, reflex: { value: 2 }, will: { value: 2 } }
    }
  });

  // Feats
  for (const it of Object.values(items)) {
    if (it.compset !== "Feat") continue;
    const ft = featTypeFromHlo(it);
    doc.items.push({
      name: it.name.replace(/\s*\(.+\)\s*$/,""), type: "feat",
      img: "systems/pf2e/icons/default-icons/feat.svg",
      system: {
        level: { value: Number(it.reqLevelNet ?? 1) },
        featType: { value: ft },
        traits: { value: [], rarity: "common" },
        description: { value: (it.useInPlay || it.reSpecial || it.rePrerequisites || "") }
      }
    });
  }

  // Actions (optional)
  for (const it of Object.values(items)) {
    if (it.compset !== "Action") continue;
    doc.items.push({
      name: it.name, type: "action",
      img: "systems/pf2e/icons/default-icons/action.svg",
      system: { traits: { value: [], rarity: "common" },
                description: { value: it.useInPlay || "" } }
    });
  }

  return doc;
}

async function applyFoundryDocToActor(doc, actor) {
  await actor.update({
    name: doc.name,
    "prototypeToken.name": doc.name,
    ...flatten(doc.system, "system")
  });

  const types = ["ancestry","heritage","background","class","feat","action","lore"];
  const old = actor.items.filter(i => types.includes(i.type));
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));

  await actor.createEmbeddedDocuments("Item", doc.items);
}

function flatten(obj, prefix="") {
  const out = {};
  for (const [k,v] of Object.entries(obj||{})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, path));
    else out[path] = v;
  }
  return out;
}
