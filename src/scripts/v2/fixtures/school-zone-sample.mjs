/** 합성 WGS84 도형과 readShp와 같은 대문자 DBF 속성. */
import { toLngLat, toUtmk } from "../../../lib/v2/crs.ts";
const [cx, cy] = toUtmk([128.5978756, 35.8808955]);
const at = (dx, dy) => toLngLat([cx + dx, cy + dy]);
const record = (id, objectid, name, x) => ({
  properties: { OBJECTID: objectid, HAKGUDO_ID: id, HAKGUDO_NM: name, HAKGUDO_GB: "0", SD_CD: "27", SGG_CD: "230", EDU_UP_NM: "대구광역시교육청", EDU_NM: "테스트교육지원청", BASE_DT: "20260320" },
  geometry: { type: "Polygon", coordinates: [[at(x-200, -300), at(x+200, -300), at(x+200, 300), at(x-200, 300), at(x-200, -300)]] },
});
export const sampleSchoolZones = () => [
  record("Z000100973", "6127", "옥산초통학구역", -100),
  record("Z000100973", "6128", "옥산초통학구역", 100),
  record("Z000200001", "2001", "테스트중학교군", 0),
  record("Z000300001", "3001", "테스트고등학교군", 0),
];
