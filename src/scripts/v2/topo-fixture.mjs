import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_X = 1_000_000;
export const BASE_Y = 2_000_000;
export const PRJ_5179 = 'PROJCS["Unknown_Name",GEOGCS["G",DATUM["D",SPHEROID["GRS_1980",6378137.0,298.257222101]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",1000000.0],PARAMETER["False_Northing",2000000.0],PARAMETER["Central_Meridian",127.5],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';
export const PRJ_5187 = 'PROJCS["Korea_2000_East_Belt_2010",GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",129.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';

function bboxOfGeometries(geometries) {
  const points = geometries.flatMap((geometry) => geometry.type === "point" ? [geometry.coordinates] : geometry.parts.flat());
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function shapeTypeOf(type) {
  return type === "point" ? 1 : type === "polyline" ? 3 : 5;
}

function shapeContent(geometry) {
  if (geometry.type === "point") {
    const content = Buffer.alloc(20);
    content.writeInt32LE(1, 0);
    content.writeDoubleLE(geometry.coordinates[0], 4);
    content.writeDoubleLE(geometry.coordinates[1], 12);
    return content;
  }
  const parts = geometry.parts;
  const points = parts.flat();
  const content = Buffer.alloc(44 + parts.length * 4 + points.length * 16);
  content.writeInt32LE(shapeTypeOf(geometry.type), 0);
  const [minX, minY, maxX, maxY] = bboxOfGeometries([geometry]);
  content.writeDoubleLE(minX, 4);
  content.writeDoubleLE(minY, 12);
  content.writeDoubleLE(maxX, 20);
  content.writeDoubleLE(maxY, 28);
  content.writeInt32LE(parts.length, 36);
  content.writeInt32LE(points.length, 40);
  let pointOffset = 44 + parts.length * 4;
  let pointIndex = 0;
  for (let i = 0; i < parts.length; i += 1) {
    content.writeInt32LE(pointIndex, 44 + i * 4);
    for (const [x, y] of parts[i]) {
      content.writeDoubleLE(x, pointOffset);
      content.writeDoubleLE(y, pointOffset + 8);
      pointOffset += 16;
      pointIndex += 1;
    }
  }
  return content;
}

function shpHeader(shapeType, fileLengthWords, bbox) {
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE(fileLengthWords, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(shapeType, 32);
  header.writeDoubleLE(bbox[0], 36);
  header.writeDoubleLE(bbox[1], 44);
  header.writeDoubleLE(bbox[2], 52);
  header.writeDoubleLE(bbox[3], 60);
  return header;
}

function writeShp(dir, base, geometries, fields, rows, { prj = PRJ_5179, cpg = true } = {}) {
  const shapeType = shapeTypeOf(geometries[0].type);
  const bbox = bboxOfGeometries(geometries);
  const records = geometries.map((geometry, index) => {
    const content = shapeContent(geometry);
    const header = Buffer.alloc(8);
    header.writeInt32BE(index + 1, 0);
    header.writeInt32BE(content.length / 2, 4);
    return { content, bytes: Buffer.concat([header, content]) };
  });
  const shpBody = Buffer.concat(records.map(({ bytes }) => bytes));
  writeFileSync(join(dir, `${base}.shp`), Buffer.concat([shpHeader(shapeType, (100 + shpBody.length) / 2, bbox), shpBody]));

  const shxRecords = [];
  let offsetWords = 50;
  for (const { content } of records) {
    const record = Buffer.alloc(8);
    record.writeInt32BE(offsetWords, 0);
    record.writeInt32BE(content.length / 2, 4);
    shxRecords.push(record);
    offsetWords += 4 + content.length / 2;
  }
  writeFileSync(join(dir, `${base}.shx`), Buffer.concat([shpHeader(shapeType, (100 + shxRecords.length * 8) / 2, bbox), ...shxRecords]));

  const fieldBytes = fields.map((field) => {
    const descriptor = Buffer.alloc(32);
    Buffer.from(field.name, "ascii").copy(descriptor, 0, 0, 10);
    descriptor[11] = field.type === "C" ? 0x43 : 0x4e;
    descriptor[16] = field.length;
    descriptor[17] = field.decimals ?? 0;
    return descriptor;
  });
  const headerLength = 32 + fieldBytes.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const dbfHeader = Buffer.alloc(headerLength);
  dbfHeader[0] = 0x03;
  dbfHeader[1] = 126;
  dbfHeader[2] = 10;
  dbfHeader[3] = 17;
  dbfHeader.writeUInt32LE(rows.length, 4);
  dbfHeader.writeUInt16LE(headerLength, 8);
  dbfHeader.writeUInt16LE(recordLength, 10);
  Buffer.concat([...fieldBytes, Buffer.from([0x0d])]).copy(dbfHeader, 32);
  const dbfRecords = rows.map((row) => {
    const record = Buffer.alloc(recordLength, 0x20);
    let offset = 1;
    for (const field of fields) {
      const value = row[field.name];
      const text = value == null ? "" : String(value);
      const encoded = Buffer.from(field.type === "N" ? text.padStart(field.length, " ") : text.padEnd(field.length, " "), "utf8");
      encoded.copy(record, offset, 0, Math.min(field.length, encoded.length));
      offset += field.length;
    }
    return record;
  });
  writeFileSync(join(dir, `${base}.dbf`), Buffer.concat([dbfHeader, ...dbfRecords, Buffer.from([0x1a])]));
  writeFileSync(join(dir, `${base}.prj`), prj, "utf8");
  if (cpg) writeFileSync(join(dir, `${base}.cpg`), "UTF-8\n", "utf8");
}

const NUMERIC_FIELDS = [
  { name: "cont", type: "N", length: 12, decimals: 3 },
  { name: "nume", type: "N", length: 12, decimals: 3 },
  { name: "rvwd", type: "N", length: 12, decimals: 3 },
  { name: "rdln", type: "N", length: 12, decimals: 0 },
  { name: "nmly", type: "N", length: 12, decimals: 0 },
  { name: "heig", type: "N", length: 12, decimals: 3 },
];

export function buildFixture(dir, prj = PRJ_5179) {
  mkdirSync(dir, { recursive: true });
  writeShp(dir, "N3L_F0010000", [
    { type: "polyline", parts: [[[BASE_X - 180, BASE_Y - 60], [BASE_X, BASE_Y - 60], [BASE_X + 180, BASE_Y - 60]]] },
    { type: "polyline", parts: [[[BASE_X - 180, BASE_Y + 60], [BASE_X, BASE_Y + 60], [BASE_X + 180, BASE_Y + 60]]] },
  ], NUMERIC_FIELDS, [{ cont: 90 }, { cont: 110 }], { prj });
  writeShp(dir, "N3P_F0020000", [
    { type: "point", coordinates: [BASE_X, BASE_Y] },
  ], NUMERIC_FIELDS, [{ nume: 100 }], { prj, cpg: false });
  writeShp(dir, "N3L_A0020000", [
    { type: "polyline", parts: [[[BASE_X - 220, BASE_Y - 150], [BASE_X + 220, BASE_Y - 150]]] },
  ], NUMERIC_FIELDS, [{ rvwd: 6, rdln: 2 }], { prj });
  writeShp(dir, "N3A_B0010000", [
    { type: "polygon", parts: [[
      [BASE_X - 40, BASE_Y - 40], [BASE_X + 40, BASE_Y - 40], [BASE_X + 40, BASE_Y + 40], [BASE_X - 40, BASE_Y - 40],
    ]] },
  ], NUMERIC_FIELDS, [{ nmly: 1 }], { prj });
}
