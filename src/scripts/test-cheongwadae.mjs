import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, '../../output');
const OUT_FILE = path.join(OUT_DIR, 'cheongwadae-analysis.json');

const CENTER = { lat: 37.5866, lng: 126.9748 };
const RADIUS_KM = 3;

const mockResult = {
  projectGoal: "사이트 분석 ppt 생성",
  center: CENTER,
  radiusKm: RADIUS_KM,
  layers: [
    { type: "satellite_map", source: "pending_selection", status: "rendered_background" },
    { type: "subways", count: 14, style: { icon: "circle", hasLineColor: true } },
    { type: "mountains", count: 4, style: { icon: "triangle", label: true } },
    { type: "schools", count: 22, style: { icon: "flag", label: true } },
    { type: "parks", count: 8, style: { icon: "tree", label: true } },
    { type: "apartments", count: 5, style: { icon: "building", shape: "rectangle", line: "solid", hasLabel: true } }
  ],
  pptStructure: [
    { slide: 1, title: "청와대 중심 반경 3km 전체 뷰 (위성지도)", layers: "all" },
    { slide: 2, title: "청와대 3km 내 주요 인프라 (지하철, 학교, 공원)", layers: ["subways", "schools", "parks"] },
    { slide: 3, title: "청와대 3km 내 자연 환경 (산)", layers: ["mountains"] },
    { slide: 4, title: "청와대 3km 내 분양 아파트", layers: ["apartments"] }
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