import {
  booleanValid,
  kinks,
  multiPolygon,
  polygon,
} from "@turf/turf";

const KOREA_BOUNDS = Object.freeze({ west: 124, south: 33, east: 132, north: 39.5 });
const DATASET_LAYERS = Object.freeze({ "30335": "UD602", "30336": "UD501" });
const ORIGINAL_CRS = new Set(["EPSG:5186", "EPSG:2097", "EPSG:5174"]);

export class MaintenanceDataValidationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "MaintenanceDataValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new MaintenanceDataValidationError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validBbox(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => !Number.isFinite(entry))) return false;
  const [west, south, east, north] = value;
  return west >= KOREA_BOUNDS.west && west <= east && east <= KOREA_BOUNDS.east
    && south >= KOREA_BOUNDS.south && south <= north && north <= KOREA_BOUNDS.north;
}

function validUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validRetrievedAt(value) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function equalBbox(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePosition(position, featureIndex) {
  if (!Array.isArray(position) || position.length !== 2 || position.some((value) => !Number.isFinite(value))) {
    fail("INVALID_COORDINATE", `Feature ${featureIndex} contains a non-finite WGS84 position`);
  }
  const [lng, lat] = position;
  if (lng < KOREA_BOUNDS.west || lng > KOREA_BOUNDS.east
    || lat < KOREA_BOUNDS.south || lat > KOREA_BOUNDS.north) {
    fail("INVALID_COORDINATE", `Feature ${featureIndex} has a coordinate outside Korea WGS84 bounds`);
  }
  return [lng, lat];
}

function validateRing(ring, featureIndex) {
  if (!Array.isArray(ring) || ring.length < 4) {
    fail("INVALID_RING", `Feature ${featureIndex} contains a ring with fewer than four positions`);
  }
  const positions = ring.map((position) => validatePosition(position, featureIndex));
  const first = positions[0];
  const last = positions.at(-1);
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    fail("INVALID_RING", `Feature ${featureIndex} contains an open ring`);
  }
  return positions;
}

function validatePolygon(polygon, featureIndex) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    fail("INVALID_RING", `Feature ${featureIndex} contains an empty polygon`);
  }
  return polygon.flatMap((ring) => validateRing(ring, featureIndex));
}

function validateGeometry(geometry, featureIndex) {
  if (!isObject(geometry)) fail("INVALID_COORDINATE", `Feature ${featureIndex} has no geometry`);
  let positions;
  if (geometry.type === "Polygon") {
    positions = validatePolygon(geometry.coordinates, featureIndex);
  } else if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      fail("INVALID_RING", `Feature ${featureIndex} contains an empty MultiPolygon`);
    }
    positions = geometry.coordinates.flatMap((polygon) => validatePolygon(polygon, featureIndex));
  } else {
    fail("INVALID_COORDINATE", `Feature ${featureIndex} must have Polygon or MultiPolygon geometry`);
  }
  try {
    const feature = geometry.type === "Polygon"
      ? polygon(geometry.coordinates)
      : multiPolygon(geometry.coordinates);
    if (!booleanValid(feature) || kinks(feature).features.length > 0) {
      fail("INVALID_GEOMETRY", `Feature ${featureIndex} contains invalid or self-intersecting geometry`);
    }
  } catch (error) {
    if (error instanceof MaintenanceDataValidationError) throw error;
    fail("INVALID_GEOMETRY", `Feature ${featureIndex} cannot be represented as valid GeoJSON geometry`);
  }
  const lngs = positions.map(([lng]) => lng);
  const lats = positions.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function validateProvenance(properties, featureIndex) {
  const requiredText = ["source_feature_id", "source_dataset_id", "source_layer", "original_crs"];
  const missingText = requiredText.some((key) => typeof properties?.[key] !== "string" || !properties[key].trim());
  if (!isObject(properties) || missingText || !validUrl(properties.source_url)
    || !validRetrievedAt(properties.retrieved_at) || !validBbox(properties.bbox)) {
    fail("MISSING_PROVENANCE", `Feature ${featureIndex} is missing required provenance`);
  }
  if (DATASET_LAYERS[properties.source_dataset_id] !== properties.source_layer
    || !ORIGINAL_CRS.has(properties.original_crs)) {
    fail("INVALID_PROVENANCE", `Feature ${featureIndex} has an unsupported dataset, layer, or original CRS`);
  }
  if (!Array.isArray(properties.notice_ids)
    || properties.notice_ids.some((value) => typeof value !== "string")
    || (properties.area_sqm !== undefined && !Number.isFinite(properties.area_sqm))
    || ["name", "sido", "sigungu", "designation_date", "source_updated_at"]
      .some((key) => properties[key] !== undefined && typeof properties[key] !== "string")) {
    fail("INVALID_PROVENANCE", `Feature ${featureIndex} has properties rejected by the production boundary loader`);
  }
}

export function validateArtifactDocuments({ geojson, metadata, quarantine }) {
  if (!isObject(metadata) || metadata.schema_version !== 1) {
    fail("INVALID_SCHEMA_VERSION", "Boundary metadata schema_version must equal 1");
  }
  const inputCount = metadata.input_feature_count;
  const outputCount = metadata.output_feature_count;
  const quarantineCount = metadata.quarantined_feature_count;
  if (![inputCount, outputCount, quarantineCount].every(isCount)) {
    fail("COUNT_MISMATCH", "Boundary metadata counts must be non-negative integers");
  }
  if (outputCount === 0) fail("EMPTY_OUTPUT", "Boundary artifact must contain at least one feature");
  if (inputCount !== outputCount + quarantineCount) {
    fail("COUNT_MISMATCH", "Input count must equal output plus quarantine counts");
  }
  if (!validBbox(metadata.bbox)) fail("INVALID_BBOX", "Metadata bbox must be finite and inside Korea WGS84 bounds");
  if (!Array.isArray(quarantine) || quarantine.length !== quarantineCount) {
    fail("QUARANTINE_COUNT_MISMATCH", "Quarantine document length must match metadata");
  }
  if (!isObject(geojson) || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)
    || geojson.features.length !== outputCount) {
    fail("FEATURE_COUNT_MISMATCH", "GeoJSON feature count must match metadata");
  }
  const datasetIds = new Set();
  const featureBboxes = [];
  for (const [index, feature] of geojson.features.entries()) {
    if (!isObject(feature) || feature.type !== "Feature") {
      fail("INVALID_COORDINATE", `Feature ${index} is not a GeoJSON Feature`);
    }
    validateProvenance(feature.properties, index);
    const geometryBbox = validateGeometry(feature.geometry, index);
    if (!equalBbox(feature.properties.bbox, geometryBbox)) {
      fail("BBOX_MISMATCH", `Feature ${index} bbox does not match its transformed WGS84 geometry`);
    }
    featureBboxes.push(geometryBbox);
    if (typeof feature.properties.source_dataset_id === "string" && feature.properties.source_dataset_id.trim()) {
      datasetIds.add(feature.properties.source_dataset_id);
    }
  }
  const collectionBbox = [
    Math.min(...featureBboxes.map(([west]) => west)),
    Math.min(...featureBboxes.map(([, south]) => south)),
    Math.max(...featureBboxes.map(([, , east]) => east)),
    Math.max(...featureBboxes.map(([, , , north]) => north)),
  ];
  if (!equalBbox(metadata.bbox, collectionBbox)) {
    fail("COLLECTION_BBOX_MISMATCH", "Metadata bbox does not reconcile all transformed features");
  }
  return {
    schemaVersion: 1,
    inputCount,
    outputCount,
    quarantineCount,
    bbox: [...metadata.bbox],
    datasetIds: [...datasetIds].sort(),
  };
}

export function validateClientSource(source, relativePath, secretValues = []) {
  if (secretValues.some((secret) => typeof secret === "string" && secret.length >= 8 && source.includes(secret))) {
    return new MaintenanceDataValidationError("CLIENT_SECRET_VALUE", `Client source contains a configured secret value: ${relativePath}`);
  }
  if (/DATA_GO_KR_API_KEY|SEOUL_OPEN_API_KEY/.test(source)) {
    return new MaintenanceDataValidationError("CLIENT_SECRET_REFERENCE", `Client source references a server secret: ${relativePath}`);
  }
  if (/https?:\/\/[^\s'"`]*data\.go\.kr[^\s'"`]*(?:serviceKey|[?&]key=)/i.test(source)
    || /data\.go\.kr[\s\S]{0,300}serviceKey/i.test(source)
    || /serviceKey[\s\S]{0,300}data\.go\.kr/i.test(source)) {
    return new MaintenanceDataValidationError("CLIENT_KEYED_CALL", `Client source contains a keyed data.go.kr call: ${relativePath}`);
  }
  return null;
}
