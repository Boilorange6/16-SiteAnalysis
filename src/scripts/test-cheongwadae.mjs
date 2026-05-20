import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, '../../output');
const OUT_FILE = path.join(OUT_DIR, 'cheongwadae-analysis.json');

const CENTER = { lat: 37.5866, lng: 126.9748 };
const RADIUS_KM = 3;

function points(coords) {
  return coords.map(([lat, lng]) => ({ lat, lng }));
}

const SUBWAY_POINTS = points([
  [37.57584, 126.97356],
  [37.57652, 126.98544],
  [37.57016, 126.98292],
  [37.57142, 126.99189],
  [37.57093, 126.97689],
  [37.56572, 126.96633],
  [37.56530, 126.97703],
  [37.56629, 126.98222],
  [37.57043, 126.99214],
  [37.57264, 127.01640],
  [37.57977, 126.99750],
  [37.58089, 127.00193],
  [37.58907, 127.00905],
  [37.59297, 126.95025],
  [37.58383, 126.96969],
  [37.58234, 126.97292],
  [37.58599, 126.98169],
  [37.58627, 126.98918],
  [37.58846, 127.00622],
  [37.60091, 126.95915],
  [37.60109, 126.93598],
  [37.55997, 126.96367],
  [37.55851, 126.97825],
  [37.56101, 126.99318],
  [37.56470, 127.00542],
  [37.56961, 127.01523],
  [37.59492, 126.96377],
]);

const mockResult = {
  projectGoal: "사이트 분석 ppt 생성",
  center: CENTER,
  radiusKm: RADIUS_KM,
  layers: [
    {
      type: "satellite_map",
      source: "mapbox://styles/mapbox/satellite-streets-v12",
      status: "rendered_background"
    },
    {
      type: "subways",
      count: SUBWAY_POINTS.length,
      style: { icon: "circle", hasLineColor: true },
      items: SUBWAY_POINTS
    },
    {
      type: "mountains",
      count: 5,
      style: { icon: "triangle", label: true },
      items: Array(5).fill({ lat: 37.59, lng: 126.98 })
    },
    {
      type: "schools",
      count: 24,
      style: { icon: "flag", label: true },
      items: Array(24).fill({ lat: 37.57, lng: 126.97 })
    },
    {
      type: "parks",
      count: 13,
      style: { icon: "tree", label: true },
      items: Array(13).fill({ lat: 37.58, lng: 126.97 })
    },
    {
      type: "apartments",
      count: 8,
      style: { icon: "building", shape: "rectangle", line: "solid", hasLabel: true },
      items: Array(8).fill({ lat: 37.57, lng: 126.96 })
    }
  ],
  pptStructure: [
    { slide: 1, title: "표지", layers: "none" },
    { slide: 2, title: "청와대 중심 반경 3km 전체 뷰 (위성지도)", layers: "all" },
    { slide: 3, title: "교통 분석 (지하철)", layers: ["subways"] },
    { slide: 4, title: "교육 환경 (학교)", layers: ["schools"] },
    { slide: 5, title: "자연 환경 (산, 공원)", layers: ["mountains", "parks"] },
    { slide: 6, title: "분양 아파트 현황", layers: ["apartments"] },
    { slide: 7, title: "종합 요약", layers: "none" }
  ],
  visualStyle: "네이비+화이트 기반 컨설팅 스타일",
  message: "청와대 반경 3km 사이트 분석 완료 및 PPT 초안(JSON) 생성 성공"
};

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  
  fs.writeFileSync(OUT_FILE, JSON.stringify(mockResult, null, 2), 'utf-8');
  console.log(`[Success] 분석 결과물이 생성되었습니다: ${OUT_FILE}`);
}

main();
