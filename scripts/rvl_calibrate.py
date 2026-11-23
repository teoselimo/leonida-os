"""Calibration capture → GTADB : homographie (≥4 points) ou affine (3 points), résidus et validation croisée."""
import numpy as np, json, sys
def fit_h(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u]); A.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _, _, V = np.linalg.svd(np.array(A, float)); H = V[-1].reshape(3, 3); return H / H[2, 2]
def fit_a(src, dst):
    S = np.array([[x, y, 1] for x, y in src], float); D = np.array(dst, float)
    M, *_ = np.linalg.lstsq(S, D, rcond=None); H = np.eye(3); H[:2, :] = M.T; return H
def proj(H, p):
    v = H @ np.array([p[0], p[1], 1.0]); return v[:2] / v[2]
def run(pairs, queries, kind="h"):
    src = [p[1] for p in pairs]; dst = [p[2] for p in pairs]; fit = fit_h if kind == "h" else fit_a
    H = fit(src, dst)
    res = [float(np.hypot(*(proj(H, s) - np.array(d)))) for s, d in zip(src, dst)]
    loo = []
    need = 4 if kind == "h" else 3
    if len(pairs) > need:
        for i in range(len(pairs)):
            Hi = fit([s for j, s in enumerate(src) if j != i], [d for j, d in enumerate(dst) if j != i])
            loo.append((pairs[i][0], float(np.hypot(*(proj(Hi, src[i]) - np.array(dst[i]))))))
    out = {"kind": kind, "n": len(pairs), "fit_residuals": dict(zip([p[0] for p in pairs], [round(r, 1) for r in res])), "loo": {k: round(v, 1) for k, v in loo},
           "rms_loo": round(float(np.sqrt(np.mean([v * v for _, v in loo]))), 1) if loo else None,
           "queries": {k: [round(float(c), 1) for c in proj(H, q)] for k, q in queries.items()}}
    return out
if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1])); print(json.dumps(run(cfg["pairs"], cfg["queries"], cfg.get("kind", "h")), indent=1, ensure_ascii=False))
