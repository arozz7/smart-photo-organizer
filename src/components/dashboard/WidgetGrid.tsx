import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors, KeyboardSensor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import OnThisDayWidget from './OnThisDayWidget'
import LibraryStatsWidget from './LibraryStatsWidget'
import PeopleSpotlightWidget from './PeopleSpotlightWidget'
import RecentActivityWidget from './RecentActivityWidget'
import FunFactsWidget from './FunFactsWidget'
import ScanEntertainmentWidget from './ScanEntertainmentWidget'
import TimelineWidget from './TimelineWidget'
import LibraryHealthWidget from './LibraryHealthWidget'
import CollageWidget from './CollageWidget'
import LocationWidget from './LocationWidget'
import DraggableWidget from './DraggableWidget'
import { useDashboard } from '../../context/DashboardContext'

/** Map widget size config to Tailwind col-span class */
function sizeToColSpan(size: string, id: string): string {
    // Some widgets always span full width
    const alwaysFullWidth = ['scanEntertainment', 'onThisDay', 'collage'];
    if (alwaysFullWidth.includes(id)) return 'col-span-12';

    switch (size) {
        case '2x2': return 'col-span-12';
        case '2x1': return 'col-span-12 md:col-span-8';
        case '1x1': return 'col-span-12 md:col-span-6 lg:col-span-4';
        default: return 'col-span-12 md:col-span-6';
    }
}

/** Widgets that can be resized by the user */
const RESIZABLE_WIDGETS = new Set([
    'libraryStats', 'peopleSpotlight', 'recentActivity', 'funFacts',
    'timeline', 'libraryHealth', 'locationHeatmap',
]);

export default function WidgetGrid() {
    const {
        memories, stats, topPeople, recentScans, funFact, refreshFunFact,
        timeline, libraryHealth, collagePhotos, locationClusters,
        isWidgetEnabled, layoutConfig, reorderWidgets, resizeWidget,
    } = useDashboard();

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(KeyboardSensor),
    );

    // Get enabled widgets in config order
    const enabledWidgets = layoutConfig.widgets.filter(w => isWidgetEnabled(w.id));
    const widgetIds = enabledWidgets.map(w => w.id);

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            reorderWidgets(String(active.id), String(over.id));
        }
    }

    function renderWidget(id: string) {
        switch (id) {
            case 'scanEntertainment':
                return <ScanEntertainmentWidget memories={memories} />;
            case 'onThisDay':
                return <OnThisDayWidget memories={memories} />;
            case 'collage':
                return <CollageWidget photos={collagePhotos} />;
            case 'timeline':
                return <TimelineWidget data={timeline} />;
            case 'libraryStats':
                return <LibraryStatsWidget stats={stats!} />;
            case 'peopleSpotlight':
                return <PeopleSpotlightWidget people={topPeople} />;
            case 'recentActivity':
                return <RecentActivityWidget photos={recentScans} />;
            case 'funFacts':
                return <FunFactsWidget fact={funFact} onRefresh={refreshFunFact} />;
            case 'libraryHealth':
                return libraryHealth ? <LibraryHealthWidget health={libraryHealth} /> : null;
            case 'locationHeatmap':
                return <LocationWidget clusters={locationClusters} />;
            default:
                return null;
        }
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={widgetIds} strategy={verticalListSortingStrategy}>
                <div className="grid grid-cols-12 gap-4">
                    {enabledWidgets.map(widget => {
                        const content = renderWidget(widget.id);
                        if (!content) return null;

                        return (
                            <DraggableWidget
                                key={widget.id}
                                id={widget.id}
                                colSpan={sizeToColSpan(widget.size, widget.id)}
                                resizable={RESIZABLE_WIDGETS.has(widget.id)}
                                onResize={resizeWidget}
                            >
                                {content}
                            </DraggableWidget>
                        );
                    })}
                </div>
            </SortableContext>
        </DndContext>
    );
}
