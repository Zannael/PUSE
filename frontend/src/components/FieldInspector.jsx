import React, { useEffect, useMemo, useState } from 'react';

const hex = (value) => `0x${value.toString(16).toUpperCase()}`;

export default function FieldInspector({ client }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let current = true;
        client.getFieldReport().then((value) => {
            if (current) { setReport(value); setError(''); }
        }).catch((failure) => {
            if (current) { setError(failure.message); setReport(null); }
        });
        return () => { current = false; };
    }, [client, revision]);
    const fields = useMemo(() => (report?.fields || []).filter((field) =>
        `${field.id} ${field.label}`.toLowerCase().includes(query.toLowerCase())), [report, query]);
    const download = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${report.profile_id}-fields.json`;
        link.click();
        URL.revokeObjectURL(url);
    };
    return <section className="space-y-5 text-slate-100" aria-label="Developer field inspector">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold">Known save fields</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-400">Read-only view of the current save bytes. Unknown event flags are not classified.</p></div>
            <div className="flex gap-2">
                <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 hover:bg-slate-800" onClick={() => { setReport(null); setError(''); setRevision((value) => value + 1); }}>Refresh</button>
                <button type="button" disabled={!report} className="rounded-lg bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={download}>Export JSON</button>
            </div>
        </div>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {!report && !error && <p role="status">Reading fields…</p>}
        {report && <>
            <p className="text-sm text-slate-300">{report.profile_id} · Save counter {report.save_index}. Layout evidence does not confirm the ROM version.</p>
            <label className="block max-w-md text-sm">Find a known field
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2" placeholder="Trainer, badge, money…" /></label>
            <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-left text-sm">
                    <caption className="sr-only">Known fields with physical offsets and raw bytes</caption>
                    <thead className="bg-slate-800 text-slate-300"><tr>{['Field', 'Value', 'Section + offset', 'File offset', 'Raw bytes', 'Confidence'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                    <tbody>{fields.map((field) => <tr key={field.id} className="border-t border-slate-700">
                        <th scope="row" className="px-4 py-3 font-normal"><span className="block">{field.label}</span><span className="text-xs text-slate-400">{field.id}</span></th>
                        <td className="px-4 py-3">{field.decoded || '(empty)'}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono">{field.section_id} + {hex(field.relative_offset)}{field.bit !== null ? ` bit ${field.bit}` : ''}</td>
                        <td className="px-4 py-3 font-mono">{hex(field.file_offset)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono">{field.raw_hex.match(/../g)?.join(' ')}<span className="ml-2 text-xs text-slate-400">{field.width} B</span></td>
                        <td className="px-4 py-3 text-slate-400">{field.confidence === 'layout-only' ? 'Layout only; meaning unclassified' : 'Verified profile layout'}</td>
                    </tr>)}</tbody>
                </table>
                {!fields.length && <p className="p-4 text-slate-400">No known fields match this search.</p>}
            </div>
        </>}
    </section>;
}
