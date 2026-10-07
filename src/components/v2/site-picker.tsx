"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import MapFigure, { siteMarkerMode, siteMarkerRadius } from "./map-figure";
import type { MapModel } from "@/lib/v2/ui/map-layers";
import type { MapPolygon } from "@/lib/v2/tile-result";
import { framedViewport, makeProjector, metersPerPixel, worldPx } from "@/lib/v2/ui/map-projection";
import type { SiteInput } from "@/lib/v2/site";
import {
  closePolygon,
  districtFromAddress,
  formatAreaM2,
  geometryCenter,
  hasSelfIntersection,
  isParcelSelectionConnected,
  isRoadParcel,
  outerBoundary,
  polygonAreaM2,
  representativeJibun,
  selectedAreaM2,
  selectedCenter,
  toggleParcelPnu,
  type LngLat,
  type SitePickerGeometry,
  type SitePickerMode,
  type SitePickerParcel,
} from "@/lib/v2/ui/site-picker";
import styles from "./site-picker.module.css";

type SitePickerProps = {
  address: string;
  radiusM: number;
  initialSite?: SiteInput | null;
  initialParcels?: readonly SitePickerParcel[];
  disabled?: boolean;
  serverError?: string | null;
  onSiteChange: (site: SiteInput | null) => void;
  onValidityChange?: (valid: boolean) => void;
};

type GeocodeReply = { lat?: number; lng?: number; address?: string; error?: string };
type BboxReply = { parcels?: SitePickerParcel[]; truncated?: boolean; error?: string };

const MODE_LABELS: Record<SitePickerMode, string> = { address: "주소 필지", parcels: "필지 합치기", polygon: "구역 그리기" };
const MIN_ZOOM_SCALE = 0.72;
const MAX_ZOOM_SCALE = 3.2;

function siteSignature(site: SiteInput | null | undefined): string {
  return site ? JSON.stringify(site) : "";
}

function modeFromSite(site: SiteInput | null | undefined): SitePickerMode {
  if (site && "polygon" in site) return "polygon";
  return site && site.pnus.length > 1 ? "parcels" : "address";
}

function geometryFromRecord(record: SitePickerParcel): SitePickerGeometry {
  return record.geometry;
}

function mapPolygonForParcel(parcel: SitePickerParcel): MapPolygon {
  const rings = parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates : parcel.geometry.coordinates.flat();
  return {
    layer: "parcel",
    fid: parcel.pnu,
    label: parcel.label,
    rings: rings.map((ring) => closePolygon(ring)),
  };
}

function formatRadius(radiusM: number): string {
  return radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inverseWorld(x: number, y: number, zoom: number): LngLat {
  const size = 256 * 2 ** zoom;
  const lng = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [lng, lat];
}

function mapCenterAfterPixels(center: LngLat, dx: number, dy: number, scale: number, radiusM: number, size: { w: number; h: number }): LngLat {
  const viewport = framedViewport(center, radiusM, size.w, size.h, 0.5, 0.8, 0.5);
  const [x, y] = worldPx(viewport.center[0], viewport.center[1], viewport.zoom);
  return inverseWorld(x - dx / scale, y - dy / scale, viewport.zoom);
}

function screenPointFromClient(clientX: number, clientY: number, canvas: HTMLDivElement, center: LngLat, radiusM: number, size: { w: number; h: number }, scale: number): LngLat | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) * (size.w / rect.width);
  const y = (clientY - rect.top) * (size.h / rect.height);
  const viewport = framedViewport(center, radiusM, size.w, size.h, 0.5, 0.8, 0.5);
  const [worldX, worldY] = worldPx(viewport.center[0], viewport.center[1], viewport.zoom);
  return inverseWorld(worldX + x - size.w / 2, worldY + y - size.h / 2, viewport.zoom);
}

function polygonPath(points: readonly [number, number][]): string {
  return points.length === 0 ? "" : `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`;
}

function uniqueJimok(parcels: readonly SitePickerParcel[]): string {
  const values = [...new Set(parcels.map((parcel) => parcel.jimok?.trim()).filter((value): value is string => !!value))];
  return values.length > 0 ? values.join(" · ") : "미확인";
}

async function responseJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export default function SitePicker({ address, radiusM, initialSite = null, initialParcels = [], disabled = false, serverError = null, onSiteChange, onValidityChange }: SitePickerProps) {
  const initialSignature = siteSignature(initialSite);
  const initialMode = modeFromSite(initialSite);
  const [mode, setMode] = useState<SitePickerMode>(initialMode);
  const [addressParcel, setAddressParcel] = useState<SitePickerParcel | null>(null);
  const [parcels, setParcels] = useState<SitePickerParcel[]>(() => [...initialParcels]);
  const [selectedPnus, setSelectedPnus] = useState<string[]>(initialSite && "pnus" in initialSite ? [...initialSite.pnus] : []);
  const [drawPoints, setDrawPoints] = useState<LngLat[]>(initialSite && "polygon" in initialSite ? initialSite.polygon.slice(0, -1).map(([lng, lat]) => [lng, lat]) : []);
  const [drawDone, setDrawDone] = useState(initialSite && "polygon" in initialSite);
  const [center, setCenter] = useState<LngLat | null>(initialSite && "polygon" in initialSite ? geometryCenter({ type: "Polygon", coordinates: [initialSite.polygon as LngLat[]] }) : null);
  const [mapCenter, setMapCenter] = useState<LngLat | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previousAddressRef = useRef(address);
  const ownedSiteSignatureRef = useRef(initialSignature);
  const lastDraftSignatureRef = useRef<string | null>(null);
  const altForNextFeatureRef = useRef(false);
  const ignoreMapClickRef = useRef(false);
  const dragVertexRef = useRef<{ index: number; pointerId: number } | null>(null);
  const pointerMapRef = useRef(new Map<number, { x: number; y: number; pan: boolean }>());
  const pinchRef = useRef<{ distance: number; scale: number; center: LngLat; centroid: { x: number; y: number } } | null>(null);
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; center: LngLat; moved: boolean } | null>(null);
  const bboxRequestRef = useRef<AbortController | null>(null);

  const resetFromInitial = (site: SiteInput | null | undefined) => {
    const nextMode = modeFromSite(site);
    setMode(nextMode);
    setSelectedPnus(site && "pnus" in site ? [...site.pnus] : []);
    setDrawPoints(site && "polygon" in site ? site.polygon.slice(0, -1).map(([lng, lat]) => [lng, lat]) : []);
    setDrawDone(!!site && "polygon" in site);
    setLocalStatus(null);
    ownedSiteSignatureRef.current = siteSignature(site);
  };

  useEffect(() => {
    if (previousAddressRef.current === address) return;
    previousAddressRef.current = address;
    resetFromInitial(initialSite);
    setAddressParcel(null);
    setParcels([]);
    setCenter(null);
    setMapCenter(null);
    setZoomScale(1);
  }, [address]); // address changes are the boundary for a new site selection

  useEffect(() => {
    if (initialParcels.length === 0) return;
    setParcels((current) => [...new Map([...current, ...initialParcels].map((parcel) => [parcel.pnu, parcel])).values()]);
  }, [initialParcels]);

  useEffect(() => {
    if (initialSignature === ownedSiteSignatureRef.current) return;
    resetFromInitial(initialSite);
  }, [initialSignature]);

  useEffect(() => {
    const element = mapPaneRef.current;
    if (!element) return;
    const read = () => {
      const next = { w: Math.round(element.clientWidth), h: Math.round(element.clientHeight) };
      if (next.w > 0 && next.h > 0) setSize((current) => current && current.w === next.w && current.h === next.h ? current : next);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!address.trim()) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/site/api/geocode?query=${encodeURIComponent(address.trim())}`, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const body = await responseJson<GeocodeReply>(response);
        if (!response.ok || typeof body.lng !== "number" || typeof body.lat !== "number") throw new Error(body.error ?? "주소 위치를 찾지 못했습니다");
        const next: LngLat = [body.lng, body.lat];
        setCenter(next);
        setMapCenter((current) => current ?? next);
        setLocalStatus(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCenter(null);
        setMapCenter(null);
        setLocalStatus(error instanceof Error ? error.message : "주소 위치를 찾지 못했습니다");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    if (!center) return;
    const controller = new AbortController();
    void fetch(`/site/api/v2/parcels/at?lng=${encodeURIComponent(center[0])}&lat=${encodeURIComponent(center[1])}`, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const body = await responseJson<SitePickerParcel>(response);
        if (!response.ok || !body.pnu || !body.geometry) throw new Error(body.error ?? "주소 위치의 필지를 찾지 못했습니다");
        const parcel = body as SitePickerParcel;
        setAddressParcel(parcel);
        setParcels((current) => [...new Map([...current, parcel].map((item) => [item.pnu, item])).values()]);
        setSelectedPnus((current) => mode === "address" && current.length === 0 ? [parcel.pnu] : current);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (mode === "address") setLocalStatus(error instanceof Error ? error.message : "주소 위치의 필지를 찾지 못했습니다");
      });
    return () => controller.abort();
  }, [center]);

  const visibleRadius = radiusM / zoomScale;
  useEffect(() => {
    if (!mapCenter || !size || zoomScale < 0.84) return;
    const timer = window.setTimeout(() => {
      bboxRequestRef.current?.abort();
      const controller = new AbortController();
      bboxRequestRef.current = controller;
      const latDelta = (visibleRadius * 1.35) / 110_574;
      const lngDelta = (visibleRadius * 1.35) / (111_320 * Math.max(0.2, Math.cos((mapCenter[1] * Math.PI) / 180)));
      const query = new URLSearchParams({ w: String(mapCenter[0] - lngDelta), s: String(mapCenter[1] - latDelta), e: String(mapCenter[0] + lngDelta), n: String(mapCenter[1] + latDelta) });
      void fetch(`/site/api/v2/parcels/bbox?${query.toString()}`, { credentials: "include", signal: controller.signal })
        .then(async (response) => {
          const body = await responseJson<BboxReply>(response);
          if (!response.ok || !Array.isArray(body.parcels)) throw new Error(body.error ?? "화면 범위 필지를 불러오지 못했습니다");
          setTruncated(!!body.truncated);
          setParcels((current) => {
            const merged = new Map(current.map((parcel) => [parcel.pnu, parcel]));
            body.parcels!.forEach((parcel) => merged.set(parcel.pnu, parcel));
            return [...merged.values()];
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLocalStatus(error instanceof Error ? error.message : "화면 범위 필지를 불러오지 못했습니다");
        });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [mapCenter, size, zoomScale, radiusM, visibleRadius]);

  const parcelByPnu = useMemo(() => new Map(parcels.map((parcel) => [parcel.pnu, parcel])), [parcels]);
  const selectedParcels = useMemo(() => selectedPnus.map((pnu) => parcelByPnu.get(pnu)).filter((parcel): parcel is SitePickerParcel => !!parcel), [parcelByPnu, selectedPnus]);
  const polygonClosed = drawDone && drawPoints.length >= 3;
  const selfCrossing = mode === "polygon" && drawPoints.length >= 4 && hasSelfIntersection(closePolygon(drawPoints));
  const polygonInput = polygonClosed && !selfCrossing ? closePolygon(drawPoints) : null;
  const draftSite: SiteInput | null = mode === "polygon"
    ? polygonInput ? { polygon: polygonInput } : null
    : selectedPnus.length > 0 ? { pnus: [...selectedPnus] } : null;
  const selectedCenterPoint = mode === "polygon"
    ? polygonInput ? geometryCenter({ type: "Polygon", coordinates: [polygonInput] }) : null
    : selectedCenter(selectedParcels);
  const boundary = mode === "polygon"
    ? drawPoints.length >= 3 ? [closePolygon(drawPoints)] : []
    : outerBoundary(selectedParcels);
  const connected = mode !== "parcels" || isParcelSelectionConnected(selectedParcels);
  const roadsIncluded = mode !== "polygon" && selectedParcels.some(isRoadParcel);
  const valid = mode === "polygon"
    ? !!polygonInput && !selfCrossing
    : selectedPnus.length > 0 && selectedParcels.length === selectedPnus.length && connected;

  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  useEffect(() => {
    const signature = siteSignature(draftSite);
    if (signature === lastDraftSignatureRef.current) return;
    lastDraftSignatureRef.current = signature;
    ownedSiteSignatureRef.current = signature;
    onSiteChange(draftSite);
  }, [draftSite ? JSON.stringify(draftSite) : ""]); // draftSite is intentionally serialized: coordinates are the identity

  useEffect(() => {
    if (mode !== "polygon") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setDrawDone(false);
        setDrawPoints((points) => points.slice(0, -1));
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        setDrawDone(false);
        setDrawPoints((points) => points.slice(0, -1));
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDrawDone(false);
        setDrawPoints([]);
        setLocalStatus("구역 그리기를 취소했습니다. 지도에서 다시 점을 추가해 주세요.");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  const mapModel: MapModel | null = useMemo(() => {
    if (!mapCenter || !size) return null;
    const polygons = parcels.map(mapPolygonForParcel);
    return { center: mapCenter, radiusM, features: [], polygons, polygonsTotal: polygons.length, siteParcel: null, total: polygons.length, notes: [], basemap: "Base" };
  }, [mapCenter, radiusM, size, parcels]);
  const labelParcels = useMemo(() => {
    if (!mapCenter) return parcels.slice(0, 120);
    const selected = new Set(selectedPnus);
    const distance = (parcel: SitePickerParcel) => {
      const point = geometryCenter(parcel.geometry);
      return point ? (point[0] - mapCenter[0]) ** 2 + (point[1] - mapCenter[1]) ** 2 : Number.POSITIVE_INFINITY;
    };
    return parcels
      .slice()
      .sort((a, b) => Number(selected.has(b.pnu)) - Number(selected.has(a.pnu)) || distance(a) - distance(b))
      .slice(0, 120);
  }, [mapCenter, parcels, selectedPnus]);
  const viewport = mapCenter && size ? framedViewport(mapCenter, radiusM, size.w, size.h, 0.5, 0.8, 0.5) : null;
  const project = viewport ? makeProjector(viewport) : null;
  const projectedBoundary = project ? boundary.map((ring) => ring.map(([lng, lat]) => project(lng, lat))) : [];
  const selectedScreenCenter = project && selectedCenterPoint ? project(selectedCenterPoint[0], selectedCenterPoint[1]) : null;
  const mapCanvasStyle = { transform: `scale(${zoomScale})` };

  const setModeAndPrepare = (nextMode: SitePickerMode) => {
    if (disabled) return;
    setMode(nextMode);
    setLocalStatus(null);
    if (nextMode === "polygon") {
      setDrawDone(false);
      setDrawPoints([]);
    } else if (nextMode === "address") {
      setDrawDone(false);
      setDrawPoints([]);
      setSelectedPnus(addressParcel ? [addressParcel.pnu] : []);
    } else {
      setDrawDone(false);
      setDrawPoints([]);
      setSelectedPnus((current) => current.length > 0 ? current : addressParcel ? [addressParcel.pnu] : []);
    }
  };

  const handleFeatureClick = (pick: { fid?: string }) => {
    const pnu = pick.fid;
    if (!pnu || mode === "polygon") return;
    const parcel = parcelByPnu.get(pnu);
    if (!parcel) return;
    const alt = altForNextFeatureRef.current;
    altForNextFeatureRef.current = false;
    if (mode === "address") {
      setSelectedPnus([pnu]);
      setLocalStatus(null);
      return;
    }
    if (alt) {
      setSelectedPnus([pnu]);
      setLocalStatus("Alt+클릭으로 새 필지 묶기를 시작했습니다.");
      return;
    }
    const toggled = toggleParcelPnu(selectedPnus, pnu);
    setSelectedPnus(toggled.pnus);
    setLocalStatus(toggled.limited ? "필지는 최대 30개까지 선택할 수 있습니다." : null);
  };

  const handleMapClick = (coordinate: { lng: number; lat: number }) => {
    if (ignoreMapClickRef.current || mode !== "polygon") return;
    setDrawDone(false);
    setDrawPoints((points) => [...points, [coordinate.lng, coordinate.lat]]);
    setLocalStatus(null);
  };

  const handleViewportClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (ignoreMapClickRef.current || disabled || mode !== "polygon" || !canvasRef.current || !mapCenter || !size) return;
    const target = event.target as Element;
    // The map pane captures the pointer for panning, so a click may bubble with
    // the pane itself as target even when the pointer started on the SVG.
    if (target.closest("[data-site-picker-control]")) return;
    const point = screenPointFromClient(event.clientX, event.clientY, canvasRef.current, mapCenter, radiusM, size, zoomScale);
    if (!point) return;
    setDrawDone(false);
    setDrawPoints((points) => [...points, point]);
    setLocalStatus(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !canvasRef.current?.contains(event.target as Node)) return;
    const target = event.target as Element;
    if (target.closest("[data-map-feature], [data-site-picker-control]")) {
      if (target.closest("[data-map-feature]")) altForNextFeatureRef.current = event.altKey;
      return;
    }
    const map = pointerMapRef.current;
    map.set(event.pointerId, { x: event.clientX, y: event.clientY, pan: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (map.size === 1 && mapCenter) panStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, center: mapCenter, moved: false };
    if (map.size === 2) {
      const points = [...map.values()];
      const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      pinchRef.current = { distance: Math.max(1, distance), scale: zoomScale, center: mapCenter ?? [0, 0], centroid: { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 } };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const map = pointerMapRef.current;
    if (!map.has(event.pointerId)) return;
    map.set(event.pointerId, { ...map.get(event.pointerId)!, x: event.clientX, y: event.clientY });
    if (pinchRef.current && mapCenter && size) {
      const points = [...map.values()];
      if (points.length < 2) return;
      const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      const centroid = { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
      setZoomScale(clamp(pinchRef.current.scale * distance / pinchRef.current.distance, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE));
      setMapCenter(mapCenterAfterPixels(pinchRef.current.center, centroid.x - pinchRef.current.centroid.x, centroid.y - pinchRef.current.centroid.y, zoomScale, radiusM, size));
      return;
    }
    const start = panStartRef.current;
    if (!start || !mapCenter || !size) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 3) return;
    start.moved = true;
    setMapCenter(mapCenterAfterPixels(start.center, dx, dy, zoomScale, radiusM, size));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (start?.pointerId === event.pointerId && start.moved) {
      ignoreMapClickRef.current = true;
      window.setTimeout(() => { ignoreMapClickRef.current = false; }, 0);
    }
    pointerMapRef.current.delete(event.pointerId);
    if (pointerMapRef.current.size < 2) pinchRef.current = null;
    if (start?.pointerId === event.pointerId) panStartRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (disabled || !canvasRef.current?.contains(event.target as Node)) return;
    setZoomScale((current) => clamp(current * (event.deltaY < 0 ? 1.13 : 0.885), MIN_ZOOM_SCALE, MAX_ZOOM_SCALE));
  };

  const handleVertexPointerDown = (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
    event.stopPropagation();
    dragVertexRef.current = { index, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleVertexMove = (event: ReactPointerEvent<SVGCircleElement>) => {
    const drag = dragVertexRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvasRef.current || !mapCenter || !size) return;
    const next = screenPointFromClient(event.clientX, event.clientY, canvasRef.current, mapCenter, radiusM, size, zoomScale);
    if (!next) return;
    setDrawDone(false);
    setDrawPoints((points) => points.map((point, pointIndex) => pointIndex === drag.index ? next : point));
  };

  const handleVertexUp = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (dragVertexRef.current?.pointerId === event.pointerId) dragVertexRef.current = null;
  };

  const closeByFirstPoint = (event: React.MouseEvent<SVGCircleElement>) => {
    event.stopPropagation();
    if (drawPoints.length >= 3) {
      setDrawDone(true);
      setLocalStatus(null);
    }
  };

  const nudgeVertex = (index: number, dx: number, dy: number) => {
    const meterPerLng = 111_320 * Math.max(0.2, Math.cos(((drawPoints[index]?.[1] ?? 0) * Math.PI) / 180));
    const deltaLng = dx / meterPerLng;
    const deltaLat = dy / 110_574;
    setDrawDone(false);
    setDrawPoints((points) => points.map((point, pointIndex) => pointIndex === index ? [point[0] + deltaLng, point[1] + deltaLat] : point));
  };

  const selectionArea = mode === "polygon" ? polygonAreaM2(drawPoints) : selectedAreaM2(selectedParcels);
  const representative = mode === "polygon" ? "직접 그린 구역" : representativeJibun(selectedParcels, districtFromAddress(address));
  let statusText = serverError || localStatus;
  let statusTone: "status" | "good" | "warning" | "error" = serverError || localStatus ? "error" : "status";
  if (!statusText && mode === "parcels" && selectedParcels.length > 0 && !connected) {
    statusText = "선택한 필지가 인접하지 않습니다. 인접한 필지만 선택해 주세요.";
    statusTone = "error";
  } else if (!statusText && mode === "polygon" && selfCrossing) {
    statusText = "구역 선이 서로 교차합니다. 점을 끌어 교차를 없애 주세요.";
    statusTone = "error";
  } else if (!statusText && roadsIncluded) {
    statusText = "도로(지목 '도')가 포함되어 있습니다. 분석은 가능하지만 도로 포함 여부를 확인해 주세요.";
    statusTone = "warning";
  } else if (!statusText && truncated) {
    statusText = "필지가 많아 일부만 표시됩니다. 확대하면 필지가 보입니다.";
    statusTone = "warning";
  } else if (!statusText && mode === "polygon" && !polygonInput) {
    statusText = drawPoints.length < 3 ? "점을 3개 이상 추가한 뒤 첫 점을 눌러 닫아 주세요." : "첫 점을 눌러 구역을 닫아 주세요.";
    statusTone = "status";
  } else if (!statusText && valid) {
    statusText = "✓ 이 대지로 분석할 수 있습니다. 반경 중심은 대지 안쪽 점입니다.";
    statusTone = "good";
  } else if (!statusText && loading) {
    statusText = "주소 위치를 찾는 중…";
    statusTone = "status";
  }

  return (
    <section className={styles.root} aria-label="대지 지정">
      <div className={styles.segments} role="tablist" aria-label="대지 지정 방식">
        {(Object.keys(MODE_LABELS) as SitePickerMode[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={mode === candidate}
            className={`${styles.segment} ${mode === candidate ? styles.segmentActive : ""}`}
            onClick={() => setModeAndPrepare(candidate)}
            disabled={disabled}
          >
            {MODE_LABELS[candidate]}
          </button>
        ))}
      </div>
      <div className={styles.layout}>
        <div
          ref={mapPaneRef}
          className={styles.mapPane}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onClick={handleViewportClick}
        >
          <div ref={canvasRef} className={styles.mapViewport}>
            <div className={styles.mapMeasure}>
              {mapModel && size && project ? (
                <div className={styles.mapCanvas} style={mapCanvasStyle}>
                  <MapFigure
                    model={mapModel}
                    width={size.w}
                    height={size.h}
                    fixed
                    basemap="tiles"
                    layer="Base"
                    bare
                    legend={false}
                    north={false}
                    scale={false}
                    credit={false}
                    selectedFids={selectedPnus}
                    onFeatureClick={mode === "polygon" ? undefined : handleFeatureClick}
                  />
                  <svg className={styles.overlay} viewBox={`0 0 ${size.w} ${size.h}`} aria-label="대지 선택 지도">
                    {labelParcels.map((parcel) => {
                      const rings = parcel.geometry.type === "Polygon" ? parcel.geometry.coordinates : parcel.geometry.coordinates.flat();
                      const points = rings[0]?.map(([lng, lat]) => project(lng, lat)) ?? [];
                      const labelPoint = geometryCenter(geometryFromRecord(parcel));
                      const labelScreen = labelPoint ? project(labelPoint[0], labelPoint[1]) : null;
                      return (
                        <g key={`label-${parcel.pnu}`}>
                          {labelScreen && <text x={labelScreen[0]} y={labelScreen[1]} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={selectedPnus.includes(parcel.pnu) ? 800 : 500} fill={selectedPnus.includes(parcel.pnu) ? "#15171c" : "#676c76"}>{parcel.label}</text>}
                          {points.length > 2 && <path d={polygonPath(points)} fill="transparent" stroke="transparent" strokeWidth={8} />}
                        </g>
                      );
                    })}
                    {projectedBoundary.map((ring, index) => <path key={`site-boundary-${index}`} d={polygonPath(ring)} fill={mode === "polygon" ? "rgba(192,86,33,.12)" : "rgba(255,255,255,.2)"} stroke="#fff" strokeWidth={4.5} strokeLinejoin="round" />)}
                    {projectedBoundary.map((ring, index) => <path key={`site-boundary-ink-${index}`} d={polygonPath(ring)} fill="none" stroke={selfCrossing ? "#b42318" : "#111"} strokeWidth={2} strokeLinejoin="round" />)}
                    {selectedScreenCenter && (() => {
                      const markerR = siteMarkerRadius(size.h);
                      const points = projectedBoundary.flat();
                      const markerMode = siteMarkerMode(points);
                      const [x, y] = selectedScreenCenter;
                      return (
                        <g role="img" aria-label="선택한 대지 표식">
                          {markerMode === "parcel" ? (
                            <>
                              <g transform={`translate(${x} ${y}) rotate(45)`}><rect x={-0.7 * markerR} y={-0.7 * markerR} width={1.4 * markerR} height={1.4 * markerR} fill="#fff" stroke="#111" strokeWidth={0.22 * markerR} /></g>
                              <circle cx={x} cy={y} r={0.2 * markerR} fill="#111" />
                            </>
                          ) : (
                            <>
                              <circle cx={x} cy={y} r={1.25 * markerR} fill="none" stroke="#fff" strokeWidth={0.55 * markerR} />
                              <circle cx={x} cy={y} r={1.25 * markerR} fill="none" stroke="#111" strokeWidth={0.22 * markerR} />
                              <path d={`M${x} ${y - 2 * markerR}V${y - 0.6 * markerR}M${x} ${y + 0.6 * markerR}V${y + 2 * markerR}M${x - 2 * markerR} ${y}H${x - 0.6 * markerR}M${x + 0.6 * markerR} ${y}H${x + 2 * markerR}`} fill="none" stroke="#111" strokeWidth={0.8 * markerR} />
                              <circle cx={x} cy={y} r={0.28 * markerR} fill="#111" stroke="#fff" strokeWidth={0.12 * markerR} />
                            </>
                          )}
                        </g>
                      );
                    })()}
                    {mode === "polygon" && drawPoints.map((point, index) => {
                      const screen = project(point[0], point[1]);
                      return <circle key={`vertex-${index}`} className={styles.vertex} data-site-picker-control tabIndex={0} role="button" aria-label={`구역 점 ${index + 1}`} cx={screen[0]} cy={screen[1]} r={Math.max(7, siteMarkerRadius(size.h))} onClick={index === 0 ? closeByFirstPoint : undefined} onPointerDown={(event) => handleVertexPointerDown(event, index)} onPointerMove={handleVertexMove} onPointerUp={handleVertexUp} onPointerCancel={handleVertexUp} />;
                    })}
                  </svg>
                </div>
              ) : (
                <div className={styles.emptyMap}>{loading ? "주소 위치를 찾는 중…" : "주소를 입력하면 지도가 열립니다."}</div>
              )}
            </div>
          </div>
          <div className={styles.radiusPreview} aria-label={`분석 반경 ${formatRadius(radiusM)}`}><span className={styles.radiusDot} aria-hidden />반경 {formatRadius(radiusM)}</div>
          {(zoomScale < 0.84 || truncated) && <div className={styles.mapNotice}>{zoomScale < 0.84 ? "필지 윤곽을 보려면 지도를 확대해 주세요." : "필지가 많습니다. 확대하면 필지가 보입니다."}</div>}
          <div className={styles.instruction}>{mode === "address" ? "주소 위치의 필지가 선택됩니다 · 지도를 끌어 이동하고 휠로 확대" : mode === "parcels" ? "필지를 누르면 추가, 다시 누르면 빼기 · Alt+클릭은 새로 시작" : "지도를 눌러 점 추가 · 첫 점을 누르거나 ‘그리기 끝’으로 닫기 · 점을 끌어 수정"}</div>
        </div>
        <aside className={styles.panel} aria-label="대지 패널">
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}>대지 패널</h2><span className={styles.panelMode}>{MODE_LABELS[mode]}</span></div>
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statLabel}>{mode === "polygon" ? "구역" : "필지 수"}</span><strong className={styles.statValue}>{mode === "polygon" ? (polygonInput ? "1" : "미완료") : `${selectedParcels.length}개`}</strong></div>
            <div className={styles.stat}><span className={styles.statLabel}>{mode === "polygon" ? "면적 추정" : "면적 합"}</span><strong className={styles.statValue}>{formatAreaM2(selectionArea)}</strong></div>
            <div className={styles.stat}><span className={styles.statLabel}>지목</span><strong className={styles.statValue}>{mode === "polygon" ? "직접 지정" : uniqueJimok(selectedParcels)}</strong></div>
            <div className={styles.stat}><span className={styles.statLabel}>반경</span><strong className={styles.statValue}>{formatRadius(radiusM)}</strong></div>
          </div>
          <p className={styles.representative}><span className={styles.representativeLabel}>대표 지번</span>{representative}</p>
          {mode !== "polygon" ? (
            <>
              <p className={styles.selectedTitle}><span>고른 필지</span><span>{selectedParcels.length}/{mode === "parcels" ? 30 : 1}</span></p>
              <ul className={styles.selectedList} aria-label="고른 필지 목록">
                {selectedParcels.map((parcel) => <li className={styles.selectedItem} key={parcel.pnu}><span>{parcel.label}{parcel.jimok ? ` · ${parcel.jimok}` : ""}</span><button type="button" className={styles.removeButton} aria-label={`${parcel.label} 선택 해제`} onClick={() => setSelectedPnus((current) => current.filter((pnu) => pnu !== parcel.pnu))} disabled={disabled}>×</button></li>)}
              </ul>
            </>
          ) : (
            <>
              <p className={styles.selectedTitle}><span>그린 점</span><span>{drawPoints.length}개</span></p>
              <div className={styles.pointList} aria-label="그린 점 목록">
                {drawPoints.map((_, index) => <div className={styles.pointRow} key={`point-row-${index}`}><span>점 {index + 1}</span><span className={styles.nudgeGroup}><button type="button" className={styles.nudgeButton} aria-label={`점 ${index + 1} 왼쪽 이동`} onClick={() => nudgeVertex(index, -1, 0)}>←</button><button type="button" className={styles.nudgeButton} aria-label={`점 ${index + 1} 위 이동`} onClick={() => nudgeVertex(index, 0, 1)}>↑</button><button type="button" className={styles.nudgeButton} aria-label={`점 ${index + 1} 아래 이동`} onClick={() => nudgeVertex(index, 0, -1)}>↓</button><button type="button" className={styles.nudgeButton} aria-label={`점 ${index + 1} 오른쪽 이동`} onClick={() => nudgeVertex(index, 1, 0)}>→</button></span></div>)}
              </div>
              <div className={styles.toolRow} data-site-picker-control>
                <button type="button" className={`${styles.toolButton} ${styles.toolButtonPrimary}`} onClick={() => { if (drawPoints.length >= 3) { setDrawDone(true); setLocalStatus(null); } }} disabled={disabled || drawPoints.length < 3}>그리기 끝</button>
                <button type="button" className={styles.toolButton} onClick={() => { setDrawDone(false); setDrawPoints((points) => points.slice(0, -1)); }} disabled={disabled || drawPoints.length === 0}>되돌리기</button>
                <button type="button" className={styles.toolButton} onClick={() => { setDrawDone(false); setDrawPoints([]); setLocalStatus(null); }} disabled={disabled || drawPoints.length === 0}>다시 그리기</button>
              </div>
            </>
          )}
          {statusText && <p className={`${styles.status} ${statusTone === "good" ? styles.statusGood : statusTone === "warning" ? styles.statusWarning : statusTone === "error" ? styles.statusError : ""}`} role={statusTone === "error" ? "alert" : "status"}>{statusText}</p>}
          <p className={styles.helpText}>{mode === "polygon" ? "Ctrl+Z·⌫: 마지막 점 되돌리기 · Esc: 그리기 취소 · 점 목록의 화살표로 키보드 수정" : "지도 이동: 한 손가락/마우스 드래그 · 확대: 휠 또는 두 손가락 · 필지 선택: 탭 또는 Enter"}</p>
        </aside>
      </div>
    </section>
  );
}
