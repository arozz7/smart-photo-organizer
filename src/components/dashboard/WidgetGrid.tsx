import OnThisDayWidget from './OnThisDayWidget'
import LibraryStatsWidget from './LibraryStatsWidget'
import PeopleSpotlightWidget from './PeopleSpotlightWidget'
import RecentActivityWidget from './RecentActivityWidget'
import FunFactsWidget from './FunFactsWidget'
import ScanEntertainmentWidget from './ScanEntertainmentWidget'
import TimelineWidget from './TimelineWidget'
import LibraryHealthWidget from './LibraryHealthWidget'
import CollageWidget from './CollageWidget'
import { useDashboard } from '../../context/DashboardContext'

export default function WidgetGrid() {
    const { memories, stats, topPeople, recentScans, funFact, refreshFunFact, timeline, libraryHealth, collagePhotos, isWidgetEnabled } = useDashboard();

    return (
        <div className="grid grid-cols-12 gap-4">
            {/* Scan Entertainment — full width, auto-hides when idle */}
            {isWidgetEnabled('scanEntertainment') && (
                <div className="col-span-12">
                    <ScanEntertainmentWidget memories={memories} />
                </div>
            )}

            {/* Row 1: On This Day — full width */}
            {isWidgetEnabled('onThisDay') && (
                <div className="col-span-12">
                    <OnThisDayWidget memories={memories} />
                </div>
            )}

            {/* Collage — full width */}
            {isWidgetEnabled('collage') && (
                <div className="col-span-12">
                    <CollageWidget photos={collagePhotos} />
                </div>
            )}

            {/* Timeline — full width */}
            {isWidgetEnabled('timeline') && (
                <div className="col-span-12">
                    <TimelineWidget data={timeline} />
                </div>
            )}

            {/* Row 2: Stats + People Spotlight */}
            {isWidgetEnabled('libraryStats') && (
                <div className={`col-span-12 ${isWidgetEnabled('peopleSpotlight') ? 'lg:col-span-4' : ''}`}>
                    <LibraryStatsWidget stats={stats!} />
                </div>
            )}
            {isWidgetEnabled('peopleSpotlight') && (
                <div className={`col-span-12 ${isWidgetEnabled('libraryStats') ? 'lg:col-span-8' : ''}`}>
                    <PeopleSpotlightWidget people={topPeople} />
                </div>
            )}

            {/* Row 3: Recent Activity + Fun Facts */}
            {isWidgetEnabled('recentActivity') && (
                <div className={`col-span-12 ${isWidgetEnabled('funFacts') ? 'md:col-span-6' : ''}`}>
                    <RecentActivityWidget photos={recentScans} />
                </div>
            )}
            {isWidgetEnabled('funFacts') && (
                <div className={`col-span-12 ${isWidgetEnabled('recentActivity') ? 'md:col-span-6' : ''}`}>
                    <FunFactsWidget fact={funFact} onRefresh={refreshFunFact} />
                </div>
            )}

            {/* Library Health — half width or full */}
            {isWidgetEnabled('libraryHealth') && libraryHealth && (
                <div className="col-span-12 md:col-span-6">
                    <LibraryHealthWidget health={libraryHealth} />
                </div>
            )}
        </div>
    );
}
