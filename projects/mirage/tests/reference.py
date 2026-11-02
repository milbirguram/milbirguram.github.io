"""Independent reference values for tests/stats.test.js.

scipy is not installed here, so this script derives every value from first principles
with a different method from model.js:
  * Student t two-sided p: Simpson integration of the t density (math.lgamma), not the
    incomplete beta continued fraction used in model.js.
  * Normal tail: math.erfc from the Python standard library.
  * Welch, Mann-Whitney and OLS: written out again here, independently of model.js, with
    numpy only for the OLS matrix algebra.
Run with:  python -I projects/mirage/tests/reference.py
"""
import math
import numpy as np


def t_pdf(x, df):
    c = math.lgamma((df + 1) / 2) - math.lgamma(df / 2) - 0.5 * math.log(df * math.pi)
    return math.exp(c - (df + 1) / 2 * math.log1p(x * x / df))


def t_two_sided(t, df, steps=200000):
    t = abs(t)
    h = t / steps
    s = t_pdf(0, df) + t_pdf(t, df)
    for i in range(1, steps):
        s += (4 if i % 2 else 2) * t_pdf(i * h, df)
    area = s * h / 3  # integral from 0 to t
    return 1 - 2 * area


def norm_two_sided(z):
    return math.erfc(abs(z) / math.sqrt(2))


def welch(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b)
    t = (a.mean() - b.mean()) / math.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    return t, df, t_two_sided(t, df)


def mann_whitney(a, b, continuity=True):
    pooled = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    n1, n2 = len(a), len(b)
    N = n1 + n2
    ranks = {}
    i = 0
    ties = 0
    while i < N:
        j = i
        while j + 1 < N and pooled[j + 1][0] == pooled[i][0]:
            j += 1
        ranks[pooled[i][0]] = (i + 1 + j + 1) / 2
        c = j - i + 1
        ties += c ** 3 - c
        i = j + 1
    r1 = sum(ranks[v] for v in a)
    U = r1 - n1 * (n1 + 1) / 2
    mu = n1 * n2 / 2
    var = n1 * n2 / 12 * ((N + 1) - ties / (N * (N - 1)))
    d = abs(U - mu) - (0.5 if continuity else 0)
    z = max(d, 0) / math.sqrt(var)
    return U, z, norm_two_sided(z)


def ols(y, g, x=None):
    y = np.asarray(y, float)
    cols = [np.ones(len(y)), np.asarray(g, float)]
    if x is not None:
        cols.append(np.asarray(x, float))
    X = np.column_stack(cols)
    XtX_inv = np.linalg.inv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    resid = y - X @ beta
    df = len(y) - X.shape[1]
    s2 = resid @ resid / df
    se = math.sqrt(s2 * XtX_inv[1, 1])
    t = beta[1] / se
    return beta[1], se, t, df, t_two_sided(t, df)


A = [4.1, 5.3, 6.0, 5.5, 7.2, 4.8, 6.6, 5.9, 6.1, 5.0, 7.7, 6.3]
B = [3.9, 4.4, 5.1, 4.0, 5.6, 6.2, 3.5, 4.9, 4.2, 5.4]
# Ties on purpose, like the 0-10 rating.
RA = [6, 7, 7, 5, 8, 6, 9, 7, 6, 8, 7, 5, 6]
RB = [5, 6, 6, 4, 7, 5, 6, 5, 8, 6, 5, 4]
Y = [31, 28, 35, 40, 22, 30, 33, 29, 36, 27, 38, 25, 34, 30]
G = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0]
X = [7.0, 6.5, 7.5, 8.0, 5.5, 7.25, 6.75, 6.0, 8.25, 6.5, 7.0, 5.75, 7.5, 7.0]

if __name__ == '__main__':
    for t, df in [(2.0, 30), (2.042, 30), (2.228, 10), (2.845, 20), (1.0, 5), (3.0, 5), (0.5, 100), (4.0, 12.7), (2.5, 58.3), (1.3, 2)]:
        print('t', t, df, round(t_two_sided(t, df), 6))
    for z in [1.96, 1.0, 2.576, 3.2]:
        print('z', z, round(norm_two_sided(z), 6))
    print('welch', welch(A, B))
    print('mw', mann_whitney(RA, RB))
    print('mw_nocc', mann_whitney(RA, RB, False))
    print('mw_cont', mann_whitney(A, B))
    print('ols1', ols(Y, G))
    print('ols2', ols(Y, G, X))
