import { useEffect, useState } from 'react';

export default function GraphicsResources({ client, profileId, onChanged }) {
    const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('');
    useEffect(() => {
        let current = true;
        client.getGraphicsStatus().then(result => { if (current) setStatus(result); }).catch(() => {});
        return () => { current = false; };
    }, [client, profileId]);
    const run = async action => {
        setBusy(true); setError(''); setProgress(0);
        try { await action(); setStatus(await client.getGraphicsStatus()); onChanged(); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    return <section className="mt-4 space-y-2 border-t border-slate-700 pt-3" aria-label="Graphics resources">
        <h3 className="font-semibold text-slate-100">Graphics resources</h3>
        {status?.source === 'rom' ? <>
            <p>Using graphics from your compatible ROM, including shiny palettes and item icons.</p>
            <p className="text-xs text-slate-400">{status.manifest.species_count} species records · {status.manifest.item_count} item records. Spinda spots are not applied; battle forms use their default preview.</p>
            {(status.manifest.warnings || []).map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}
        </> : <p>Shared images may differ from your game; custom forms and some icons may be missing. Import a compatible ROM to use its graphics.</p>}
        {status?.storage === 'server' && <p className="text-xs text-slate-400">This pack is installed on the backend. Import here to keep a browser copy and export it.</p>}
        <p className="text-xs text-slate-400">Import processes the ROM on this device without uploading or storing it. Extracted images stay in this browser. Export a pack to use them on desktop, Switch or 3DS.</p>
        <div className="flex flex-wrap gap-2">
            <label className={`rounded-lg bg-slate-700 px-3 py-2 ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-slate-600'}`}>
                {busy ? 'Extracting…' : 'Import graphics from ROM'}
                <input type="file" accept=".gba" className="sr-only" disabled={busy} onChange={e => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (file) run(() => client.importGraphicsRom(file, setProgress));
                }} />
            </label>
            {status?.canExport && <>
                <button type="button" disabled={busy} onClick={() => run(() => client.exportGraphicsPack())} className="rounded-lg bg-slate-700 px-3 py-2 disabled:opacity-50">Export graphics pack</button>
                <button type="button" disabled={busy} onClick={() => run(() => client.clearGraphics())} className="rounded-lg bg-slate-700 px-3 py-2 disabled:opacity-50">Remove browser pack</button>
            </>}
        </div>
        {busy && <progress aria-label="Extracting graphics" value={progress} max={1} className="w-full" />}
        {error && <p role="alert" className="text-rose-300">{error}</p>}
    </section>;
}
