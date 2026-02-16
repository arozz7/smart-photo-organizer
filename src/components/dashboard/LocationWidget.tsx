import { useState, useMemo } from 'react';

interface LocationCluster {
    lat: number;
    lng: number;
    photoCount: number;
}

interface LocationWidgetProps {
    clusters: LocationCluster[];
}

/** Convert lat/lng to SVG x/y using Equirectangular projection */
function geoToSvg(lat: number, lng: number, width: number, height: number): { x: number; y: number } {
    const x = ((lng + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    return { x, y };
}

/** Interpolate between two hex colors */
function interpolateColor(t: number): string {
    // Cool blue (#3B82F6) to warm orange (#F59E0B)
    const r = Math.round(59 + t * (245 - 59));
    const g = Math.round(130 + t * (158 - 130));
    const b = Math.round(246 + t * (11 - 246));
    return `rgb(${r}, ${g}, ${b})`;
}

// Simplified world coastline paths (major landmasses)
const WORLD_PATHS = [
    // North America
    "M80,50 L90,45 L105,42 L115,40 L128,42 L135,50 L130,55 L125,52 L115,55 L105,60 L95,65 L90,72 L85,78 L82,85 L78,82 L75,75 L70,68 L65,60 L68,55 L75,52 Z",
    // South America
    "M95,95 L100,92 L108,95 L112,100 L115,108 L118,118 L120,130 L118,140 L112,148 L105,152 L98,145 L95,135 L90,125 L88,115 L90,105 Z",
    // Europe
    "M168,42 L175,38 L180,40 L185,42 L190,38 L195,40 L200,42 L198,48 L192,50 L185,52 L180,50 L175,48 L170,46 Z",
    // Africa
    "M170,58 L178,55 L188,58 L195,62 L200,70 L202,80 L198,90 L195,100 L190,108 L182,112 L175,108 L170,100 L168,90 L165,80 L166,70 L168,62 Z",
    // Asia
    "M195,35 L210,32 L225,30 L240,28 L255,30 L265,35 L270,42 L268,50 L260,55 L250,58 L240,60 L235,55 L230,50 L225,52 L218,55 L210,52 L205,48 L200,44 Z",
    // Australia
    "M255,108 L265,105 L275,108 L280,115 L278,122 L270,128 L262,125 L255,118 L253,112 Z",
    // Russia/Siberia extension
    "M195,32 L210,25 L225,22 L240,20 L255,22 L270,28 L280,30 L285,25 L290,28 L288,32 L280,35 L270,35 L260,33 L250,30 L240,28 L230,28 L220,30 L210,32 L200,35 Z",
    // Greenland
    "M120,25 L128,22 L135,24 L138,30 L135,36 L128,38 L122,35 L120,30 Z",
    // Indonesia/SE Asia
    "M242,68 L248,65 L255,68 L260,72 L265,75 L268,80 L272,85 L268,88 L262,85 L255,82 L250,78 L245,75 L242,72 Z",
    // Japan
    "M272,42 L275,38 L278,40 L276,45 L273,48 L270,45 Z",
    // UK/Ireland
    "M165,38 L168,35 L170,38 L168,42 L165,40 Z",
    // Middle East
    "M195,55 L205,52 L212,55 L215,60 L210,65 L205,62 L198,60 Z",
    // Central America
    "M80,78 L85,76 L90,78 L92,82 L88,85 L84,84 L80,82 Z",
];

export default function LocationWidget({ clusters }: LocationWidgetProps) {
    const [hoveredCluster, setHoveredCluster] = useState<LocationCluster | null>(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

    const svgWidth = 360;
    const svgHeight = 180;

    const maxCount = useMemo(() =>
        clusters.length > 0 ? Math.max(...clusters.map(c => c.photoCount)) : 1
        , [clusters]);

    const totalPhotosWithGps = useMemo(() =>
        clusters.reduce((sum, c) => sum + c.photoCount, 0)
        , [clusters]);

    const handleDotHover = (cluster: LocationCluster, e: React.MouseEvent) => {
        setHoveredCluster(cluster);
        const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
        if (rect) {
            setTooltipPos({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top - 10,
            });
        }
    };

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <span className="text-lg">🌍</span>
                        Photo Locations
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {clusters.length > 0
                            ? `${totalPhotosWithGps.toLocaleString()} photos across ${clusters.length} locations`
                            : 'Where your photos were taken'
                        }
                    </p>
                </div>
            </div>

            {clusters.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <span className="text-3xl mb-2 opacity-50">📍</span>
                    <p className="text-sm text-gray-400">No GPS data found in your library</p>
                    <p className="text-xs text-gray-600 mt-1">Photos with GPS coordinates will appear here as location dots</p>
                </div>
            ) : (
                <div className="relative">
                    <svg
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="w-full rounded-lg"
                        style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' }}
                    >
                        {/* Grid lines */}
                        {[0, 30, 60, 90, 120, 150, 180].map(y => (
                            <line key={`h${y}`} x1={0} y1={y} x2={svgWidth} y2={y} stroke="#334155" strokeWidth="0.3" strokeDasharray="2,4" />
                        ))}
                        {[0, 60, 120, 180, 240, 300, 360].map(x => (
                            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={svgHeight} stroke="#334155" strokeWidth="0.3" strokeDasharray="2,4" />
                        ))}

                        {/* Equator */}
                        <line x1={0} y1={90} x2={svgWidth} y2={90} stroke="#475569" strokeWidth="0.4" />

                        {/* Landmasses */}
                        {WORLD_PATHS.map((path, i) => (
                            <path
                                key={i}
                                d={path}
                                fill="#1e3a5f"
                                stroke="#2d5986"
                                strokeWidth="0.5"
                                opacity={0.7}
                            />
                        ))}

                        {/* Photo location dots */}
                        {clusters.map((cluster, i) => {
                            const { x, y } = geoToSvg(cluster.lat, cluster.lng, svgWidth, svgHeight);
                            const t = cluster.photoCount / maxCount;
                            const radius = 2 + t * 5;
                            const color = interpolateColor(t);

                            return (
                                <g key={i}>
                                    {/* Glow effect */}
                                    <circle
                                        cx={x} cy={y} r={radius + 2}
                                        fill={color}
                                        opacity={0.2}
                                    />
                                    {/* Main dot */}
                                    <circle
                                        cx={x} cy={y} r={radius}
                                        fill={color}
                                        stroke="white"
                                        strokeWidth="0.3"
                                        opacity={0.85}
                                        className="cursor-pointer transition-opacity hover:opacity-100"
                                        onMouseEnter={(e) => handleDotHover(cluster, e)}
                                        onMouseLeave={() => setHoveredCluster(null)}
                                    />
                                </g>
                            );
                        })}
                    </svg>

                    {/* Tooltip */}
                    {hoveredCluster && (
                        <div
                            className="absolute z-20 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white shadow-lg pointer-events-none whitespace-nowrap"
                            style={{
                                left: `${tooltipPos.x}px`,
                                top: `${tooltipPos.y - 24}px`,
                                transform: 'translateX(-50%)',
                            }}
                        >
                            <span className="font-medium">{hoveredCluster.photoCount} photo{hoveredCluster.photoCount !== 1 ? 's' : ''}</span>
                            <span className="text-gray-400 ml-1">
                                ({hoveredCluster.lat.toFixed(1)}°, {hoveredCluster.lng.toFixed(1)}°)
                            </span>
                        </div>
                    )}

                    {/* Color legend */}
                    <div className="flex items-center justify-between mt-2 px-1">
                        <span className="text-[10px] text-gray-500">Fewer photos</span>
                        <div className="h-1.5 w-24 rounded-full mx-2" style={{
                            background: 'linear-gradient(to right, #3B82F6, #F59E0B)',
                        }} />
                        <span className="text-[10px] text-gray-500">More photos</span>
                    </div>
                </div>
            )}
        </div>
    );
}
