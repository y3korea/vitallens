"""Independent re-implementation of js/stats.js, written separately, used by validation/test_stats.js
to cross-check every statistic on random data. The basic statistics use only the standard library;
the repeated-measures check needs numpy, pandas and statsmodels (see requirements.txt).
Reads {"ref": [...], "est": [...]} on stdin, prints the statistics as JSON."""
import json
import math
import sys


def repeated(records):
    """Bland-Altman 2007 variance components, cross-checked two ways: the ANOVA formula written
    out independently, and REML from a random-intercept mixed model (statsmodels) when the design
    is balanced (where the two estimators coincide whenever the between variance is positive)."""
    import numpy as np
    pids = sorted({r["pid"] for r in records})
    d = {p: np.array([r["est"] - r["ref"] for r in records if r["pid"] == p]) for p in pids}
    allv = np.concatenate(list(d.values()))
    N, n = len(allv), len(pids)
    grand = allv.mean()
    m = np.array([len(d[p]) for p in pids])
    msb = sum(len(d[p]) * (d[p].mean() - grand) ** 2 for p in pids) / (n - 1)
    msw = sum(((d[p] - d[p].mean()) ** 2).sum() for p in pids) / (N - n)
    var_b = max(0.0, (msb - msw) / ((N ** 2 - (m ** 2).sum()) / ((n - 1) * N)))
    out = {"bias": float(grand), "sdTotal": float(np.sqrt(var_b + msw)), "sdWithin": float(np.sqrt(msw)), "sdBetween": float(np.sqrt(var_b))}
    if len(set(m.tolist())) == 1 and msb > msw:
        import pandas as pd
        import statsmodels.formula.api as smf
        df = pd.DataFrame({"d": allv, "pid": np.concatenate([[p] * len(d[p]) for p in pids])})
        fit = smf.mixedlm("d ~ 1", df, groups=df["pid"]).fit(reml=True)
        out["remlVarB"] = float(fit.cov_re.iloc[0, 0])
        out["remlVarW"] = float(fit.scale)
    return out


def main():
    d = json.load(sys.stdin)
    if "records" in d:
        print(json.dumps(repeated(d["records"])))
        return
    ref, est = d["ref"], d["est"]
    n = len(ref)
    diff = [e - r for r, e in zip(ref, est)]
    bias = sum(diff) / n
    sd = math.sqrt(sum((x - bias) ** 2 for x in diff) / (n - 1))

    mr, me = sum(ref) / n, sum(est) / n
    cov = sum((r - mr) * (e - me) for r, e in zip(ref, est))
    vr = sum((r - mr) ** 2 for r in ref)
    ve = sum((e - me) ** 2 for e in est)
    pearson = cov / math.sqrt(vr * ve)
    ccc = (2 * cov / n) / (vr / n + ve / n + (mr - me) ** 2)

    # ICC(2,1) via two-way ANOVA, k = 2 raters (ref, est)
    k = 2
    grand = (sum(ref) + sum(est)) / (n * k)
    row_means = [(r + e) / 2 for r, e in zip(ref, est)]
    ss_rows = k * sum((m - grand) ** 2 for m in row_means)
    ss_cols = n * ((mr - grand) ** 2 + (me - grand) ** 2)
    ss_total = sum((v - grand) ** 2 for v in ref + est)
    ss_err = ss_total - ss_rows - ss_cols
    bms, jms, ems = ss_rows / (n - 1), ss_cols / (k - 1), ss_err / ((n - 1) * (k - 1))
    icc21 = (bms - ems) / (bms + (k - 1) * ems + k * (jms - ems) / n)

    print(json.dumps({
        "bias": bias, "sdDiff": sd, "loaLow": bias - 1.96 * sd, "loaHigh": bias + 1.96 * sd,
        "mae": sum(abs(x) for x in diff) / n,
        "rmse": math.sqrt(sum(x * x for x in diff) / n),
        "mape": 100 * sum(abs(x) / r for x, r in zip(diff, ref)) / n,
        "pearson": pearson, "ccc": ccc, "icc2_1": icc21,
    }))


if __name__ == "__main__":
    main()
