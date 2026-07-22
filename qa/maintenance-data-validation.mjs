const KOREA_BOUNDS = Object.freeze({ west: 124, south: 33, east: 132, north: 39.5 });

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

function visitPositions(value, callback) {
  if (!Array.isArray(value)) fail("INVALID_COORDINATE", "Geometry coordinates must be arrays");
  if (value.length === 2 && value.every((entry) => typeof entry === "number")) {
    callback(value);
    return;
  }
  if (value.length === 0) fail("INVALID_COORDINATE", "Geometry coordinate arrays must not be empty");
  for (const child of value) visitPositions(child, callback);
}

function validateCoordinates(geometry, featureIndex) {
  if (!isObject(geometry) || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    fail("INVALID_COORDINATE", `Feature ${featureIndex} must have Polygon or MultiPolygon geometry`);
  }
  visitPositions(geometry.coordinates, ([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < KOREA_BOUNDS.west || lng > KOREA_BOUNDS.east
      || lat < KOREA_BOUNDS.south || lat > KOREA_BOUNDS.north) {
      fail("INVALID_COORDINATE", `Feature ${featureIndex} has a coordinate outside Korea WGS84 bounds`);
    }
  });
}

function validateProvenance(properties, featureIndex) {
  const requiredText = ["source_feature_id", "source_dataset_id", "source_layer", "original_crs"];
  const missingText = requiredText.some((key) => typeof properties?.[key] !== "string" || !properties[key].trim());
  if (!isObject(properties) || missingText || !validUrl(properties.source_url)
    || !validRetrievedAt(properties.retrieved_at) || !validBbox(properties.bbox)) {
    fail("MISSING_PROVENANCE", `Feature ${featureIndex} is missing required provenance`);
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
  for (const [index, feature] of geojson.features.entries()) {
    if (!isObject(feature) || feature.type !== "Feature") {
      fail("INVALID_COORDINATE", `Feature ${index} is not a GeoJSON Feature`);
    }
    validateProvenance(feature.properties, index);
    validateCoordinates(feature.geometry, index);
    if (typeof feature.properties.source_dataset_id === "string" && feature.properties.source_dataset_id.trim()) {
      datasetIds.add(feature.properties.source_dataset_id);
    }
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
