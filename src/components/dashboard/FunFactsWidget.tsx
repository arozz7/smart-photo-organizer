import { ReloadIcon } from '@radix-ui/react-icons'

interface FunFact {
    text: string;
    type: string;
}

interface FunFactsWidgetProps {
    fact: FunFact | null;
    onRefresh: () => void;
}

export default function FunFactsWidget({ fact, onRefresh }: FunFactsWidgetProps) {
    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Fun Fact</h3>
                <button
                    onClick={onRefresh}
                    className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    title="Show another fact"
                >
                    <ReloadIcon className="w-4 h-4" />
                </button>
            </div>

            <div className="flex items-center gap-3 min-h-[48px]">
                <span className="text-2xl flex-shrink-0">💡</span>
                <p className="text-sm text-gray-300 leading-relaxed">
                    {fact?.text || 'Loading...'}
                </p>
            </div>
        </div>
    );
}
