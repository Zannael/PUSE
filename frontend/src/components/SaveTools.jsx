import { useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';

export default function SaveTools({ client }) {
    const [rtcBrokenFile, setRtcBrokenFile] = useState(null);
    const [rtcFixedFile, setRtcFixedFile] = useState(null);
    const [rtcTimeFixerFile, setRtcTimeFixerFile] = useState(null);
    const [rtcTab, setRtcTab] = useState('quick');
    const [rtcBusy, setRtcBusy] = useState(false);
    const [convertFile, setConvertFile] = useState(null);
    const [convertTarget, setConvertTarget] = useState('.sav');
    const [convertBusy, setConvertBusy] = useState(false);
    const handleRtcFixPack = async () => {
        if (!rtcBrokenFile || !rtcFixedFile) {
            alert('Please select both files: tampered save and NPC-fixed save.');
            return;
        }

        try {
            setRtcBusy(true);
            await client.generateRtcRepairPack(rtcBrokenFile, rtcFixedFile);
            alert('RTC repair pack downloaded. Test candidates in the provided order JSON.');
        } catch {
            alert('Failed to generate RTC repair pack.');
        } finally {
            setRtcBusy(false);
        }
    };

    const handleRtcTimeFixerReset = async () => {
        if (!rtcTimeFixerFile) {
            alert('Please select one Pokemon Unbound save file.');
            return;
        }

        try {
            setRtcBusy(true);
            const result = await client.reenableRtcTimeFixer(rtcTimeFixerFile);
            alert(
                `Time Fixer reset downloaded (save index ${result.save_idx}, byte ${result.absolute_offset}).\n\n` +
                'Correct the emulator/device RTC before loading it. Then use the Frozen Heights Time Fixer, save in-game, and restart.'
            );
        } catch (error) {
            alert(error?.message || 'Failed to re-enable the in-game Time Fixer.');
        } finally {
            setRtcBusy(false);
        }
    };

    const handleSaveConvert = async () => {
        if (!convertFile) {
            alert('Please select one save file to convert.');
            return;
        }

        try {
            setConvertBusy(true);
            await client.convertSaveFile(convertFile, convertTarget);
            alert(`Converted and downloaded as ${convertTarget}.`);
        } catch {
            alert('Save conversion failed. Supported sizes are 131072 and 131088 bytes.');
        } finally {
            setConvertBusy(false);
        }
    };

    return <div className="space-y-4">
        <p className="text-sm text-slate-400">These tools process the files you select below and download a separate result. If an editor session is open, it stays loaded. Time Fixer recovery is for Pokémon Unbound.</p>
        <details className="group rounded-[1.75rem] border border-amber-500/30 bg-amber-500/5 p-5 md:p-6">
            <summary className="list-none cursor-pointer flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Recovery tools</p>
                    <h3 className="mt-1 text-lg font-bold text-slate-100">Time tampering recovery</h3>
                    <p className="mt-1 text-xs text-slate-300">Prefer Unbound's own Time Fixer; use pair repair as an advanced fallback.</p>
                </div>
                <div className="text-[10px] text-amber-200 uppercase tracking-widest group-open:hidden">Open</div>
                <div className="text-[10px] text-amber-200 uppercase tracking-widest hidden group-open:block">Close</div>
            </summary>

            <div className="mt-5 border-t border-amber-500/20 pt-5">
                <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-900/60 p-1 text-[10px] uppercase tracking-widest font-bold">
                    <button
                        type="button"
                        onClick={() => setRtcTab('pair')}
                        className={`px-3 py-1 rounded-lg transition-colors ${
                            rtcTab === 'pair' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-white/5'
                        }`}
                    >
                        Pair Repair (Advanced)
                    </button>
                    <button
                        type="button"
                        onClick={() => setRtcTab('quick')}
                        className={`px-3 py-1 rounded-lg transition-colors ${
                            rtcTab === 'quick' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-white/5'
                        }`}
                    >
                        Re-enable Time Fixer
                    </button>
                </div>

                {rtcTab === 'pair' ? (
                    <>
                        <p className="mt-3 text-sm text-slate-200">
                            Build a repair pack using a tampered save and one NPC-fixed save.
                        </p>
                        <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-300">
                            <label className="block">
                                <span className="block mb-1 text-slate-400">Tampered save (.sav)</span>
                                <input
                                    type="file"
                                    accept=".sav"
                                    onChange={(e) => setRtcBrokenFile(e.target.files?.[0] || null)}
                                    className="w-full text-xs"
                                />
                            </label>
                            <label className="block">
                                <span className="block mb-1 text-slate-400">NPC-fixed save (.sav)</span>
                                <input
                                    type="file"
                                    accept=".sav"
                                    onChange={(e) => setRtcFixedFile(e.target.files?.[0] || null)}
                                    className="w-full text-xs"
                                />
                            </label>
                        </div>
                        <button
                            onClick={handleRtcFixPack}
                            disabled={rtcBusy}
                            className="mt-4 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                        >
                            <ShieldAlert size={14} /> {rtcBusy ? 'GENERATING...' : 'GENERATE PAIR REPAIR PACK'}
                        </button>
                        <p className="mt-2 text-[11px] text-slate-400">
                            Downloads manifest and fallback candidates in recommended order.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="mt-3 text-sm text-slate-200">
                            Safely re-enable the one-use Frozen Heights Time Fixer by clearing only its used flag.
                        </p>
                        <p className="mt-2 text-[11px] text-amber-300">
                            First correct the emulator or device RTC. This download does not repair RTC metadata by itself.
                        </p>
                        <div className="mt-3 text-xs text-slate-300">
                            <label className="block">
                                <span className="block mb-1 text-slate-400">Pokemon Unbound save (.sav or .srm)</span>
                                <input
                                    type="file"
                                    accept=".sav,.srm"
                                    onChange={(e) => setRtcTimeFixerFile(e.target.files?.[0] || null)}
                                    className="w-full text-xs"
                                />
                            </label>
                        </div>
                        <button
                            onClick={handleRtcTimeFixerReset}
                            disabled={rtcBusy}
                            className="mt-4 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                        >
                            <ShieldAlert size={14} /> {rtcBusy ? 'VALIDATING...' : 'RE-ENABLE TIME FIXER'}
                        </button>
                        <p className="mt-2 text-[11px] text-slate-400">
                            Validates the save, changes exactly one byte in the active generation, and preserves the older fallback copy and RTC trailer.
                        </p>
                    </>
                )}
            </div>
        </details>

        <details className="group rounded-[1.75rem] border border-cyan-500/30 bg-cyan-500/5 p-5 md:p-6">
            <summary className="list-none cursor-pointer flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Utility</p>
                    <h3 className="mt-1 text-lg font-bold text-slate-100">SRM / SAV Converter</h3>
                    <p className="mt-1 text-xs text-slate-300">Convert emulator save container format without opening the main editor.</p>
                </div>
                <div className="text-[10px] text-cyan-200 uppercase tracking-widest group-open:hidden">Open</div>
                <div className="text-[10px] text-cyan-200 uppercase tracking-widest hidden group-open:block">Close</div>
            </summary>

            <div className="mt-5 border-t border-cyan-500/20 pt-5">
                <div className="text-xs text-slate-300">
                    <label className="block">
                        <span className="block mb-1 text-slate-400">Input file (.sav or .srm)</span>
                        <input
                            type="file"
                            accept=".sav,.srm"
                            onChange={(e) => setConvertFile(e.target.files?.[0] || null)}
                            className="w-full text-xs"
                        />
                    </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-900/60 p-1 text-[10px] uppercase tracking-widest font-bold">
                    <button
                        type="button"
                        onClick={() => setConvertTarget('.sav')}
                        className={`px-3 py-1 rounded-lg transition-colors ${
                            convertTarget === '.sav' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-white/5'
                        }`}
                    >
                        To .sav
                    </button>
                    <button
                        type="button"
                        onClick={() => setConvertTarget('.srm')}
                        className={`px-3 py-1 rounded-lg transition-colors ${
                            convertTarget === '.srm' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-white/5'
                        }`}
                    >
                        To .srm
                    </button>
                </div>

                <button
                    onClick={handleSaveConvert}
                    disabled={convertBusy}
                    className="mt-4 inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900/60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                >
                    <Save size={14} /> {convertBusy ? 'CONVERTING...' : `CONVERT TO ${convertTarget.toUpperCase()}`}
                </button>
                <p className="mt-2 text-[11px] text-slate-400">
                    Supports 128 KiB and 128 KiB + 16 byte layouts. The original file is never modified.
                </p>
            </div>
        </details>
    </div>;
}
