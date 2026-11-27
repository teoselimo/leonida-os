// Usage : node scripts/map-v022-measure.mjs URL avant|apres
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const [url, version] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const measurements = [];
const layers = [];
const motion = [];
try {
  for (const [device, width, height] of [["iphone",393,852], ["ipad",1194,834]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: device === "iphone" ? 3 : 2 });
    await page.addInitScript(() => {
      // L'application expose l'instance juste après new Map(), avant le premier rendu.
      let instance;
      Object.defineProperty(window,"__leonidaMap",{
        configurable:true, get:()=>instance, set:(map)=>{instance=map; window.__mapCreatedMs=performance.now();}
      });
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 9, showDemo: false, profile: { pseudo: "Théo", chapter: 2, spoilerMode: "strict", lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"] } }));
    });
    await page.goto(url + "/#carte");
    await page.waitForFunction(() => window.__leonidaMap?.loaded() && window.__leonidaMap.getStyle().sources.landmarks.data.features?.length);
    const createdMs = await page.evaluate(() => Math.round(window.__mapCreatedMs));
    const readyMs = await page.evaluate(() => Math.round(performance.now()));
    for (const [scene, center, zoom] of [["ensemble",[-32,3],1.45],["quartier",[-29.5,-36.5],4.4],["rue",[-29.5,-36.5],6.2]]) {
      await page.evaluate(async ({center,zoom}) => {
        const map = window.__leonidaMap;
        const idle = map.once("idle");
        map.jumpTo({ center, zoom, padding: { top:0,bottom:0,left:0,right:0 } });
        await idle;
      },{center,zoom});
      const counts = await page.evaluate(() => {
        const map = window.__leonidaMap;
        return {
          sources: Object.fromEntries(Object.entries(map.getStyle().sources).filter(([,s]) => s.type === "geojson").map(([k,s]) => [k,s.data.features.length])),
          icons: new Set(map.queryRenderedFeatures({layers:["lm","lmf-pt"]}).map(f=>f.properties.id)).size,
          labels: map.queryRenderedFeatures({layers:["lm-label"]}).length,
        };
      });
      measurements.push({device,scene,zoom,createdMs,readyMs,...counts});
      if (scene !== "rue") await page.screenshot({path:`docs/v022/${device}-${scene}-${version}.jpg`,quality:82,scale:"css"});
    }
    // Même parcours de caméra en périphérie de Hamlet, moteur logiciel identique.
    if (version === "apres") {
      if (device === "iphone") await page.getByTestId("map-layers").click();
      await page.getByTestId("layer-tout").click();
    }
    const frames = await page.evaluate(async () => {
      const map = window.__leonidaMap;
      const idle = map.once("idle");
      map.triggerRepaint();
      await idle;
      const gaps = [];
      let last = performance.now();
      const sample = () => { const now = performance.now(); gaps.push(now-last); last=now; };
      map.on("render", sample);
      const end = map.once("moveend");
      map.easeTo({center:[-29.8,-36.4],zoom:6.8,duration:1500,essential:true});
      await end;
      map.off("render",sample);
      gaps.sort((a,b)=>a-b);
      return { frames:gaps.length,medianIntervalMs:Math.round(gaps[Math.floor(gaps.length/2)]),p95IntervalMs:Math.round(gaps[Math.floor(gaps.length*.95)]) };
    });
    motion.push({device,...frames});
    if (device === "ipad" && version === "apres") {
      for (const name of ["essentiels","services","sorties","reperes","tout","garage"]) {
        await page.getByTestId(name === "garage" ? "filter-garage" : "layer-"+name).click();
        await page.evaluate(async()=>{ const map=window.__leonidaMap; const idle=map.once("idle"); map.triggerRepaint(); await idle; });
        const sources = await page.evaluate(()=>Object.fromEntries(Object.entries(window.__leonidaMap.getStyle().sources)
          .filter(([,s])=>s.type==="geojson").map(([k,s])=>[k,s.data.features.length])));
        layers.push({name,...sources});
      }
    }
    await page.close();
  }
  writeFileSync(`docs/v022/mouvement-${version}.json`, JSON.stringify(motion,null,2)+"\n");
  if (layers.length) writeFileSync("docs/v022/couches.json",JSON.stringify(layers,null,2)+"\n");
  writeFileSync(`docs/v022/${version}.json`,JSON.stringify(measurements,null,2)+"\n");
} finally { await browser.close(); }
