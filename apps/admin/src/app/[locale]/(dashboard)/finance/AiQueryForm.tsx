'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { askAiAction } from './actions';

export function AiQueryForm() {
    const [question, setQuestion] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!question.trim()) return;

        setIsLoading(true);
        setError(null);
        setResult(null);

        const res = await askAiAction(question);

        setIsLoading(false);

        if (res.error) {
            setError(res.error);
        } else if (res.data) {
            setResult(res.data.result);
        }
    };

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-2">
                <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="اسألني عن مبيعاتك..."
                    className="w-full min-h-[100px] p-3 rounded-md border border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
                />
                <Button
                    type="submit"
                    disabled={isLoading}
                    className="bg-[var(--gold)] text-void hover:bg-[var(--gold-br)]"
                >
                    {isLoading ? 'جاري الاستعلام...' : 'استعلام'}
                </Button>
            </form>

            {error && (
                <div className="p-3 bg-[var(--crimson)]/10 text-[var(--crimson)] rounded-md">
                    {error}
                </div>
            )}

            {result && (
                <div className="mt-4 p-4 rounded-md bg-[var(--obsidian)] border border-[var(--rim1)]">
                    <h3 className="text-[var(--t2)] mb-2 font-semibold">النتيجة:</h3>
                    <pre className="whitespace-pre-wrap text-[var(--t1)] font-mono text-sm leading-relaxed">
                        {result}
                    </pre>
                </div>
            )}
        </div>
    );
}
