import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Map as MLMap } from "maplibre-gl";
import { openMapLayers } from "./map-controls";
import { readFileSync } from "node:fs";

declare global { interface Window { __leonidaMap: MLMap } }
const feed = readFileSync("tests/fixtures/radar-prod.json", "utf8");
const saveKey = "leonida-os/progress/v1";
async function start(page: Page, mission: string | null = null) {
  await page.route("**/__live/radar.json*", r => r.fulfill({contentType:"application/json", body:feed}));
  await page.addInitScript(({mission,saveKey}) => {
    if (localStorage.getItem(saveKey)) return;
    localStorage.setItem("leonida-os/radar-url", location.origin + "/__live/radar.json");
    localStorage.setItem(saveKey, JSON.stringify({ schema:1, rev:9, showDemo:false, vehicles:{}, done:{},
      wanted:["v-maibatsu-penumbra-ff"], profile:{ pseudo:"Théo",chapter:2,spoilerMode:"strict",nextMission:mission,missionsDone:[] } }));
  }, {mission,saveKey});
  await page.goto("/#carte");
  await page.waitForFunction(() => window.__leonidaMap?.loaded());
}
const saved = (page:Page) => page.evaluate(key=>localStorage.getItem(key),saveKey);
const featureIds = (page:Page, source="landmarks") => page.evaluate(source=>{
  const s = window.__leonidaMap.getStyle().sources[source] as {data:GeoJSON.FeatureCollection};
  return s.data.features.map(f=>String(f.properties?.id));
},source);
async function choose(page:Page,id:string) {
  await openMapLayers(page);
  await page.getByTestId("layer-"+id).click();
}

test("couches, district de mission, suivi et persistance de la caméra sans écriture de progression", async ({page})=>{
  await start(page,"Talk to Lucia");
  const before = await saved(page);
  await openMapLayers(page);
  await expect(page.getByTestId("layer-essentiels")).toHaveAttribute("aria-pressed","true");
  await expect(page.getByTestId("map-party")).toContainText("Talk to Lucia");
  await expect(page.getByTestId("map-party")).toContainText("district");
  await expect.poll(()=>featureIds(page,"zones")).toContain("veh:v-maibatsu-penumbra-ff");
  await expect(page.getByTestId("map-party")).not.toContainText("Vous êtes ici");
  const essential = await featureIds(page);
  expect(essential).toContain("L332");
  expect(essential).not.toContain("L13");
  await choose(page,"services");
  await expect.poll(async()=>(await featureIds(page)).length).toBeGreaterThan(essential.length);
  await choose(page,"sorties");
  await expect.poll(()=>featureIds(page)).toContain("L13");
  await choose(page,"reperes");
  await expect.poll(()=>featureIds(page)).not.toContain("L13");
  await choose(page,"tout");
  await expect.poll(async()=>(await featureIds(page)).length).toBe(3663);
  await page.evaluate(()=>window.__leonidaMap.jumpTo({center:[-29.5,-36.5],zoom:5.4}));
  await page.reload();
  await page.waitForFunction(()=>window.__leonidaMap?.loaded());
  await openMapLayers(page);
  await expect(page.getByTestId("layer-tout")).toHaveAttribute("aria-pressed","true");
  expect(await page.evaluate(()=>window.__leonidaMap.getZoom())).toBeCloseTo(5.4,1);
  expect(await saved(page)).toBe(before);
});

test("recherche complète et sélection visible au changement de couche", async ({page})=>{
  await start(page);
  await page.getByTestId("search-btn").click();
  await page.getByTestId("search-input").fill("Albany Hotel");
  await page.getByTestId("result-L13").click();
  await expect(page.getByTestId("landmark")).toContainText("Albany Hotel");
  await choose(page,"services");
  await expect(page.getByTestId("landmark")).toContainText("Repère communautaire");
  await expect.poll(()=>page.evaluate(()=>window.__leonidaMap.queryRenderedFeatures({layers:["lm-sel-icon"]}).map(f=>f.properties.id))).toContain("L13");
  const marker = await page.evaluate(()=>{ const map=window.__leonidaMap; const feature=map.queryRenderedFeatures({layers:["lm-sel-icon"]})[0]; const point=map.project((feature.geometry as GeoJSON.Point).coordinates as [number,number]); return map.getContainer().getBoundingClientRect().top+point.y; });
  const sheet = page.locator(".sheet").first();
  if (await sheet.isVisible()) expect(marker).toBeLessThan((await sheet.boundingBox())!.y);
});

test("pan et pincement dans Tout, sans recréer la carte ni recharger les lieux", async ({page,browserName})=>{
  await start(page);
  await choose(page,"tout");
  const area = page.locator(".maplibregl-canvas");
  const box = (await area.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await page.evaluate(()=>window.__leonidaMap.jumpTo({center:[-29.5,-36.5],zoom:6.2}));
  await page.waitForFunction(()=>window.__leonidaMap.loaded());
  const before = await page.evaluate(()=>{
    const map = window.__leonidaMap;
    const canvas = map.getCanvas();
    canvas.dataset.poiUpdates = "0";
    map.on("sourcedata", event => {
      if (event.sourceId === "landmarks" && event.sourceDataType === "content") {
        canvas.dataset.poiUpdates = String(Number(canvas.dataset.poiUpdates)+1);
      }
    });
    return map.getCenter().lng;
  });
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+60,y+10,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.__leonidaMap.getCenter().lng)).not.toBe(before);
  const zoom = await page.evaluate(()=>window.__leonidaMap.getZoom());
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    for (const radius of [20,30,42,60]) {
      await cdp.send("Input.dispatchTouchEvent",{type:radius===20?"touchStart":"touchMove",touchPoints:[{x:x-radius,y,id:0},{x:x+radius,y,id:1}]});
    }
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await cdp.detach();
  } else {
    // Double de geste sur le DOM WebKit Linux ; les TouchEvent natifs iOS exigent un appareil.
    await area.evaluate(async (canvas,{x,y})=>{
      for(const radius of [20,30,42,60,0]){
        const touches = radius ? [-1,1].map((side,i)=>({identifier:i,target:canvas,clientX:x+side*radius,clientY:y,pageX:x+side*radius,pageY:y})) : [];
        const event=new Event(!radius?"touchend":radius===20?"touchstart":"touchmove",{bubbles:true,cancelable:true});
        Object.assign(event,{touches,targetTouches:touches,changedTouches:touches});
        canvas.dispatchEvent(event);
        await new Promise(requestAnimationFrame);
      }
    },{x,y});
  }
  await expect.poll(()=>page.evaluate(()=>window.__leonidaMap.getZoom())).toBeGreaterThan(zoom+.2);
  expect((await featureIds(page)).length).toBe(3663);
  expect(await area.getAttribute("data-poi-updates")).toBe("0");
  expect(await page.evaluate(()=>(window as unknown as {__leonidaMapCount:number}).__leonidaMapCount)).toBe(1);
});
