"""One-off (kept for provenance): derive experiments/hardk/lgb_build.py from the copied original. Run from the repo root."""
p = 'experiments/hardk/lgb_build.py'
s = open(p, encoding='utf-8').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep('from sim.simulator import HARD, build_obs\n', 'from sim.simulator import HARD, build_obs\nimport experiments.hardk.kernel as kn\n')
rep('''    ap.add_argument("--tag", default=None, help="output folder suffix (holdout runs)")''',
    '''    ap.add_argument("--out-dir", required=True, help="output folder, must be under experiments/hardk/out/")
    ap.add_argument("--lin", required=True, help="linear model json written by experiments.hardk.build_model")
    ap.add_argument("--bw", type=float, default=None, help="kernel half-width in days (omit: month profiles)")
    ap.add_argument("--cyclic", action="store_true", help="cyclic day-of-year distance")
    ap.add_argument("--kernel", choices=("tri", "gauss"), default="tri")
    ap.add_argument("--co2-mult", type=float, default=None, help="planner CO2 tilt written into the model json")''')
rep('''    lin_path = ROOT / ("experiments/hard/model_holdout.json" if a.holdout else "agent_hard/model_linear.json")
    if not a.holdout and not lin_path.exists():
        lin_path = ROOT / "agent_hard/model.json"
    lin = json.loads''', '''    out_dir = Path(a.out_dir).resolve()
    assert (ROOT / "experiments/hardk/out") in out_dir.parents, "outputs must go under experiments/hardk/out/"
    lin_path = Path(a.lin)
    kernel = kn.Kernel(a.bw, a.cyclic, a.kernel) if a.bw else None
    lin = json.loads''')
# profiles per chunk
rep('''        kb = bm.monthly_kbar(df["pv_kw"].values, clear, use_df, month_df)
        kb[10] = np.nanmean([kb[9], kb[11]])
        profs[c] = dict(
            load_prof=bm._fill_gaps(bm.fit_profiles(df["load_kw"].values, df.index, dt_load, use_df)),
            price_prof=bm._fill_gaps(bm.fit_profiles(sig["price"].values, sig.index, dt_sig, use_sig)),
            co2_prof=bm._fill_gaps(bm.fit_profiles(sig["co2"].values, sig.index, dt_sig, use_sig)), kbar=kb)
''', '''        if kernel is None:
            kb = bm.monthly_kbar(df["pv_kw"].values, clear, use_df, month_df)
            kb[10] = np.nanmean([kb[9], kb[11]])
            profs[c] = dict(
                load_prof=bm._fill_gaps(bm.fit_profiles(df["load_kw"].values, df.index, dt_load, use_df)),
                price_prof=bm._fill_gaps(bm.fit_profiles(sig["price"].values, sig.index, dt_sig, use_sig)),
                co2_prof=bm._fill_gaps(bm.fit_profiles(sig["co2"].values, sig.index, dt_sig, use_sig)), kbar=kb)
        else:                                                          # centre = middle of the left-out chunk
            ctr = kn.centres_chunk(c, sig)
            Wd, Ws = kernel.weights(df.index, ctr), kernel.weights(sig.index, ctr)
            kb = bm._fill_nov_kbar(bm.monthly_kbar_k(df["pv_kw"].values, clear, use_df, Wd))
            profs[c] = dict(
                load_prof=bm._fill_gaps(bm.fit_profiles_k(df["load_kw"].values, df.index, dt_load, use_df, Wd)),
                price_prof=bm._fill_gaps(bm.fit_profiles_k(sig["price"].values, sig.index, dt_sig, use_sig, Ws)),
                co2_prof=bm._fill_gaps(bm.fit_profiles_k(sig["co2"].values, sig.index, dt_sig, use_sig, Ws)), kbar=kb)
''')
rep('''            profs[c] = {**calprof.make_profiles(df, sig, use_df, use_sig), "kbar": profs[c]["kbar"]}
        final_prof = calprof.make_profiles(df, sig, allowed_df, allowed_sig)''',
    '''            ctr = kn.centres_chunk(c, sig) if kernel else None
            profs[c] = {**calprof.make_profiles(df, sig, use_df, use_sig, kernel, ctr), "kbar": profs[c]["kbar"]}
        tgt = (kn.centres_holdout(df, sig) if a.holdout else kn.centres_final()) if kernel else None
        final_prof = calprof.make_profiles(df, sig, allowed_df, allowed_sig, kernel, tgt)''')
rep('''    out_dir = (ROOT / "experiments/hard" / ("lgb_holdout" + (f"_{a.tag}" if a.tag else ""))) if a.holdout else ROOT / "agent_hard"
    out_dir.mkdir(exist_ok=True)''', '''    out_dir.mkdir(parents=True, exist_ok=True)''')
rep('''    if a.holdout:
        model["lgb_dir"] = str(out_dir)
    json_path = (ROOT / "experiments/hard" / f"model_holdout_lgb{'_' + a.tag if a.tag else ''}.json") if a.holdout \\
        else ROOT / "agent_hard/model_lgb.json"
''', '''    if a.holdout:
        model["lgb_dir"] = str(out_dir)
    if a.co2_mult is not None:
        model["co2_mult"] = a.co2_mult
    json_path = out_dir / "model_lgb.json"
''')
open(p, 'w', encoding='utf-8').write(s)
print("patched")
