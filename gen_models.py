#!/usr/bin/env python3
# Генератор GLB-моделей танков для Tanks 3D. Без внешних библиотек (только numpy).
# Оси: +Y вверх, +Z вперёд (дуло), метры. Узлы: hull, turret (пивот башни) -> gun (ствол) -> muzzle (дуло).
# Материалы: "paint" (перекрашивается игрой в цвет нации/команды), "dark" (резина, гусеницы), "metal" (ствол, катки).
import numpy as np, struct, json, math, os, sys

MATS = {'paint': [0.45, 0.52, 0.32, 1.0], 'dark': [0.07, 0.07, 0.075, 1.0], 'metal': [0.30, 0.31, 0.33, 1.0], 'track': [1.0, 1.0, 1.0, 1.0]}
MAT_ORDER = ['paint', 'dark', 'metal', 'track']

class Part:
    def __init__(self, origin=(0, 0, 0)):
        self.o = np.array(origin, float); self.prims = {}
    def strip(self, mat, tris):
        out = self.prims.setdefault(mat, {'p': [], 'n': [], 'uv': []})
        for tri in tris:
            (p0, n0, u0), (p1, n1, u1), (p2, n2, u2) = tri
            g = np.cross(np.array(p1) - p0, np.array(p2) - p0)
            if np.dot(g, np.array(n0) + n1 + n2) < 0: (p1, n1, u1), (p2, n2, u2) = (p2, n2, u2), (p1, n1, u1)
            for p, n, u in ((p0, n0, u0), (p1, n1, u1), (p2, n2, u2)):
                out['p'].append(np.array(p, float) - self.o); out['n'].append(n); out['uv'].append(u)
    def solid(self, mat, V, T):
        V = np.array(V, float); c = V.mean(0); out = self.prims.setdefault(mat, {'p': [], 'n': [], 'uv': []})
        for a, b, d in T:
            pa, pb, pd = V[a], V[b], V[d]; n = np.cross(pb - pa, pd - pa)
            if np.dot(n, (pa + pb + pd) / 3 - c) < 0: pb, pd = pd, pb; n = -n
            ln = np.linalg.norm(n)
            if ln < 1e-12: continue
            n = n / ln
            for p in (pa, pb, pd): out['p'].append(p - self.o); out['n'].append(n)

def box(cx, cy, cz, sx, sy, sz):
    V = [(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    T = []
    for a, b, c, d in F: T += [(a, b, c), (a, c, d)]
    return V, T

def extrude_zy(prof, x0, x1):          # профиль (z,y) выдавливается по X
    n = len(prof); V = [(x0, y, z) for z, y in prof] + [(x1, y, z) for z, y in prof]; T = []
    for i in range(n):
        j = (i + 1) % n; T += [(i, j, n + j), (i, n + j, n + i)]
    for i in range(1, n - 1): T += [(0, i, i + 1), (n, n + i, n + i + 1)]
    return V, T

def loft(A, B, ya, yb):                 # два выпуклых контура (x,z) на высотах ya/yb
    n = len(A); V = [(x, ya, z) for x, z in A] + [(x, yb, z) for x, z in B]; T = []
    for i in range(n):
        j = (i + 1) % n; T += [(i, j, n + j), (i, n + j, n + i)]
    for i in range(1, n - 1): T += [(0, i, i + 1), (n, n + i, n + i + 1)]
    return V, T

def frustum(p0, p1, r0, r1, n=16):
    p0 = np.array(p0, float); p1 = np.array(p1, float); ax = p1 - p0; L = np.linalg.norm(ax); ax /= L
    t = np.array([0, 1, 0.0]) if abs(ax[1]) < 0.9 else np.array([1, 0, 0.0]); u = np.cross(ax, t); u /= np.linalg.norm(u); v = np.cross(ax, u)
    V = []
    for p, r in ((p0, r0), (p1, r1)):
        for i in range(n):
            a = 2 * math.pi * i / n; V.append(p + r * (math.cos(a) * u + math.sin(a) * v))
    V += [p0, p1]; T = []; c0, c1 = 2 * n, 2 * n + 1
    for i in range(n):
        j = (i + 1) % n; T += [(i, j, n + j), (i, n + j, n + i), (c0, j, i), (c1, n + i, n + j)]
    return V, T

def hull2d(pts):
    pts = sorted(set(pts))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def belt(cx, tw, zb, rb, zf, rf, tile=0.36):
    pts = []
    for zc, rc in ((zb, rb), (zf, rf)):
        for i in range(40):
            a = 2 * math.pi * i / 40; pts.append((round(zc + rc * math.cos(a), 5), round(rc + rc * math.sin(a), 5)))
    H = hull2d(pts); n = len(H)
    seg = [math.hypot(H[(i+1) % n][0]-H[i][0], H[(i+1) % n][1]-H[i][1]) for i in range(n)]
    total = sum(seg); nt = max(2, round(total / tile)); su = [0.0]
    for i in range(n): su.append(su[-1] + seg[i])
    en = []
    for i in range(n):
        dz, dy = H[(i+1) % n][0]-H[i][0], H[(i+1) % n][1]-H[i][1]; l = math.hypot(dz, dy); en.append((dy / l, -dz / l))
    vn = [((en[i-1][0]+en[i][0]), (en[i-1][1]+en[i][1])) for i in range(n)]
    vn = [(a / math.hypot(a, b), b / math.hypot(a, b)) for a, b in vn]
    x0, x1 = cx - tw / 2, cx + tw / 2; part = Part(); tris = []
    for i in range(n):
        j = (i + 1) % n; ui, uj = su[i] / total * nt, su[i+1] / total * nt
        def V(x, k, u, v): return ((x, H[k][1], H[k][0]), (0.0, vn[k][1], vn[k][0]), (u, v))
        A, B_, C, D = V(x0, i, ui, 0), V(x1, i, ui, 1), V(x1, j, uj, 1), V(x0, j, uj, 0)
        tris += [(A, B_, C), (A, C, D)]
    part.strip('track', tris); return part, nt / total

def rotx(V, ang):
    c, s_ = math.cos(ang), math.sin(ang); return [(x, y * c - z * s_, y * s_ + z * c) for x, y, z in V]

def wheel_part(r, w, side, tire=True, spokes=3):
    p = Part()
    V, T = frustum((-w / 2, 0, 0), (w / 2, 0, 0), r, r, 18); p.solid('dark' if tire else 'metal', V, T)
    V, T = frustum((-w * 0.52, 0, 0), (w * 0.52, 0, 0), r * 0.68, r * 0.68, 14); p.solid('metal', V, T)
    for k in range(spokes):
        V, T = box(side * w * 0.55, 0, 0, w * 0.10, r * 1.30, r * 0.16); p.solid('metal', rotx(V, math.pi * k / spokes), T)
    return p

def scale_poly(P, s, dz=0.0): return [(x * s, z * s + dz) for x, z in P]

# ---------------- параметры ----------------
CLS = {
  'light':  dict(W=2.7, tw=0.50, L=4.7, y0=0.40, deck=1.10, nw=5, rw=0.31, tr=0.72, th=0.50, gr=0.060, gl=2.7, brake=False, skirts=False, mant=0.55),
  'medium': dict(W=3.0, tw=0.60, L=5.2, y0=0.45, deck=1.28, nw=6, rw=0.37, tr=0.95, th=0.62, gr=0.085, gl=3.5, brake=False, skirts=False, mant=0.75),
  'heavy':  dict(W=3.4, tw=0.75, L=5.8, y0=0.50, deck=1.45, nw=7, rw=0.40, tr=1.18, th=0.80, gr=0.110, gl=4.2, brake=True,  skirts=True,  mant=0.95),
}
# план башни (x,z) в долях радиуса tr; пивот башни по Z (tz), и «стиль» нации
NAT = {
  'ussr':    dict(poly='round',  tz=0.30, evac=True,  drums=True,  squat=1.0),
  'usa':     dict(poly=[(-0.78,-1.40),(0.78,-1.40),(1.00,-0.55),(0.90,0.55),(0.45,1.00),(-0.45,1.00),(-0.90,0.55),(-1.00,-0.55)], tz=0.00, evac=True, drums=False, squat=1.05),
  'britain': dict(poly=[(-1.00,-1.15),(1.00,-1.15),(1.10,0.00),(0.95,0.95),(-0.95,0.95),(-1.10,0.00)], tz=-0.10, evac=True, drums=False, squat=1.1),
  'china':   dict(poly='oct',    tz=0.25, evac=True,  drums=True,  squat=0.95),
  'europe':  dict(poly=[(-0.85,-1.05),(0.85,-1.05),(1.05,-0.20),(0.62,1.00),(-0.62,1.00),(-1.05,-0.20)], tz=0.05, evac=False, drums=False, squat=1.0),
  'germany': dict(poly=[(-0.80,-1.10),(0.80,-1.10),(1.00,-0.10),(0.70,0.95),(-0.70,0.95),(-1.00,-0.10)], tz=0.00, evac=False, drums=False, squat=1.05),
}

def turret_poly(style, r):
    if style == 'round': return [(r * math.cos(2 * math.pi * i / 14) * 1.0, r * math.sin(2 * math.pi * i / 14) * 1.08) for i in range(14)]
    if style == 'oct': return [(r * math.cos(2 * math.pi * (i + .5) / 8) * 1.05, r * math.sin(2 * math.pi * (i + .5) / 8) * 1.05) for i in range(8)]
    return [(x * r, z * r) for x, z in style]

def build_tracked(cls, nation):
    P = CLS[cls]; N = NAT[nation]; W, tw, L, y0, deck = P['W'], P['tw'], P['L'], P['y0'], P['deck']
    hull = Part(); rw = P['rw']; H = 2 * rw + 0.16
    # корпус: боковой профиль (z,y) с наклонным лобовым и кормовым листом
    prof = [(-L/2 + 0.25, y0), (L/2 - 0.35, y0), (L/2 + 0.05, y0 + 0.40), (L/2 - 0.95, deck), (-L/2 + 0.55, deck), (-L/2 - 0.02, deck - 0.45)]
    hw = W / 2 - tw * 0.55
    V, T = extrude_zy(prof, -hw, hw); hull.solid('paint', V, T)
    wheels = []; tracks = []
    rs, ri = rw * 1.12, rw * 0.98
    for s_, nm in ((1, 'P'), (-1, 'N')):
        cx = s_ * (W / 2 - tw / 2); zb, zf = -L / 2 + rs, L / 2 - ri
        bp, kk = belt(cx, tw, zb, rs, zf, ri); tracks.append(('track' + nm, bp, kk))
        wheels.append(('w' + nm + 's', wheel_part(rs - 0.07, tw * 0.80, s_, tire=False, spokes=4), (cx, rs, zb), rs - 0.07))
        wheels.append(('w' + nm + 'i', wheel_part(ri - 0.07, tw * 0.80, s_, tire=False, spokes=3), (cx, ri, zf), ri - 0.07))
        n = P['nw']; z0, z1 = zb + rs + 0.12, zf - ri - 0.12
        for i in range(n):
            z = z0 + (z1 - z0) * i / (n - 1)
            wheels.append(('w' + nm + str(i), wheel_part(rw, tw * 0.62, s_), (cx, rw + 0.07, z), rw))
        V, T = box(cx, H + 0.06, 0.0, tw + 0.10, 0.06, L * 0.93); hull.solid('paint', V, T)
        if P['skirts']:
            V, T = box(s_ * (W / 2 + 0.01), (H + 0.06 + 0.45) / 2 + 0.05, 0.0, 0.05, H * 0.55, L * 0.80); hull.solid('paint', V, T)
    # детали корпуса: люк механика, фары, решётка МТО, выхлоп, ящики
    V, T = frustum((-hw * 0.45, deck - 0.34, L / 2 - 1.15), (-hw * 0.45, deck - 0.28, L / 2 - 1.15), 0.20, 0.20, 12); hull.solid('dark', V, T)
    for s in (-1, 1):
        V, T = box(s * hw * 0.8, y0 + 0.50, L / 2 - 0.05, 0.16, 0.12, 0.10); hull.solid('metal', V, T)
    V, T = box(0, deck + 0.025, -L / 2 + 1.05, hw * 1.2, 0.06, 1.2); hull.solid('dark', V, T)
    for s in (-1, 1):
        V, T = box(s * hw * 0.9, deck + 0.14, -L / 2 + 0.2, 0.35, 0.28, 0.5); hull.solid('metal', V, T)
    if N['drums']:
        for s in (-1, 1):
            V, T = frustum((s * (hw + 0.12), H + 0.22, -L / 2 + 0.25), (s * (hw + 0.12), H + 0.22, -L / 2 + 1.35), 0.17, 0.17, 12); hull.solid('metal', V, T)
    # ---- башня ----
    r = P['tr']; th = P['th'] * 1.22 * N['squat'] * (0.95 if nation in ('europe', 'germany') else 1.0)
    tx, ty, tz = 0.0, deck + 0.02, N['tz'] * r
    tur = Part((tx, ty, tz)); base = turret_poly(N['poly'], r)
    top = scale_poly(base, 0.78, 0.10 * r)
    V, T = loft([(x, z + tz) for x, z in base], [(x, z + tz) for x, z in top], ty, ty + th); tur.solid('paint', V, T)
    zf = tz + max(z for x, z in base)                                           # передняя кромка башни
    V, T = box(0, ty + th * 0.66, zf - 0.02, r * 0.66, th * 0.62, 0.32); tur.solid('paint', V, T)            # маска орудия
    V, T = frustum((0.42 * r, ty + th, tz - 0.20 * r), (0.42 * r, ty + th + 0.17, tz - 0.20 * r), 0.20, 0.17, 12); tur.solid('paint', V, T)   # башенка командира
    V, T = frustum((0.42 * r, ty + th + 0.17, tz - 0.20 * r), (0.42 * r, ty + th + 0.21, tz - 0.20 * r), 0.15, 0.15, 12); tur.solid('dark', V, T)
    V, T = frustum((-0.38 * r, ty + th - 0.02, tz - 0.05 * r), (-0.38 * r, ty + th + 0.05, tz - 0.05 * r), 0.22, 0.22, 12); tur.solid('dark', V, T)   # люк заряжающего
    V, T = box(0, ty + th * 0.30, tz + min(z for x, z in base) - 0.12, r * 0.9, th * 0.4, 0.26); tur.solid('metal', V, T)    # кормовой ящик
    if nation in ('europe', 'germany'):                                          # антенна
        V, T = frustum((-0.55 * r, ty + th, tz + min(z for x, z in base) * 0.6), (-0.55 * r + 0.1, ty + th + 1.5, tz + min(z for x, z in base) * 0.8), 0.018, 0.008, 6); tur.solid('metal', V, T)
    # ---- ствол ----
    gy = ty + th * 0.66; gz = zf + 0.14; gr, gl = P['gr'], P['gl']
    # Геометрия ствола уже в локальных координатах (origin в точке крепления),
    # поэтому Part((0,0,0)), иначе solid вычтет (0,gy,gz) и ствол уедет вниз.
    gun = Part((0, 0, 0))
    V, T = frustum((0, 0, -0.35), (0, 0, gl), gr * 1.25, gr, 14); gun.solid('metal', V, T)
    if N['evac']:
        V, T = frustum((0, 0, gl * 0.60), (0, 0, gl * 0.60 + 0.42), gr * 1.55, gr * 1.55, 12); gun.solid('metal', V, T)
    if P['brake']:
        V, T = frustum((0, 0, gl - 0.50), (0, 0, gl + 0.04), gr * 1.55, gr * 1.55, 12); gun.solid('metal', V, T)
        V, T = box(0, 0, gl - 0.25, gr * 3.4, gr * 0.6, 0.30); gun.solid('metal', V, T)
    return hull, tur, gun, (tx, ty, tz), (0, gy, gz), gl, wheels, tracks

def build_wheeled(nation):
    N = NAT[nation]; hull = Part(); L, W = 6.0, 2.7; y0, deck = 0.62, 1.55; hw = 1.05
    prof = [(-L/2 + 0.2, y0), (L/2 - 0.5, y0), (L/2 + 0.02, y0 + 0.45), (L/2 - 0.9, deck), (-L/2 + 0.6, deck), (-L/2 - 0.0, deck - 0.5)]
    V, T = extrude_zy(prof, -hw, hw); hull.solid('paint', V, T)
    wheels = []
    for s_, nm in ((1, 'P'), (-1, 'N')):
        for i, z in enumerate((-2.25, -0.78, 0.78, 2.25)):
            wheels.append(('w' + nm + str(i), wheel_part(0.56, 0.52, s_, spokes=5), (s_ * (hw + 0.14), 0.56, z), 0.56))
        V, T = box(s_ * (hw + 0.10), 1.28, 0.0, 0.50, 0.07, 5.4); hull.solid('paint', V, T)
    V, T = box(0, deck + 0.025, -L / 2 + 1.0, hw * 1.3, 0.06, 1.1); hull.solid('dark', V, T)
    V, T = frustum((-0.5, deck - 0.30, L / 2 - 1.25), (-0.5, deck - 0.22, L / 2 - 1.25), 0.2, 0.2, 12); hull.solid('dark', V, T)
    r = 0.88; th = 0.74; tx, ty, tz = 0.0, deck + 0.02, 0.35
    tur = Part((tx, ty, tz)); base = turret_poly(N['poly'] if N['poly'] != 'round' else 'oct', r)
    top = scale_poly(base, 0.80, 0.08 * r)
    V, T = loft([(x, z + tz) for x, z in base], [(x, z + tz) for x, z in top], ty, ty + th); tur.solid('paint', V, T)
    zf = tz + max(z for x, z in base)
    V, T = box(0, ty + th * 0.66, zf - 0.02, r * 0.58, th * 0.62, 0.30); tur.solid('paint', V, T)
    V, T = frustum((0.40 * r, ty + th, tz - 0.2 * r), (0.40 * r, ty + th + 0.15, tz - 0.2 * r), 0.18, 0.15, 12); tur.solid('paint', V, T)
    V, T = frustum((-0.35 * r, ty + th - 0.02, tz - 0.05 * r), (-0.35 * r, ty + th + 0.05, tz - 0.05 * r), 0.20, 0.20, 12); tur.solid('dark', V, T)
    gy = ty + th * 0.66; gz = zf + 0.12; gr, gl = 0.075, 3.0
    # Геометрия ствола уже в локальных координатах — origin (0,0,0)
    gun = Part((0, 0, 0))
    V, T = frustum((0, 0, -0.3), (0, 0, gl), gr * 1.2, gr, 14); gun.solid('metal', V, T)
    V, T = frustum((0, 0, gl - 0.4), (0, 0, gl + 0.03), gr * 1.5, gr * 1.5, 12); gun.solid('metal', V, T)
    return hull, tur, gun, (tx, ty, tz), (0, gy, gz), gl, wheels, []

# ---------------- экспорт GLB ----------------
def write_glb(path, hull, tur, gun, tpos, gpos, gl, wheels=(), tracks=()):
    bin_ = bytearray(); bviews = []; accs = []; meshes = []
    def add_view(data, target):
        while len(bin_) % 4: bin_.append(0)
        off = len(bin_); bin_.extend(data); bviews.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}); return len(bviews) - 1
    def mesh_of(part, name):
        prims = []
        for mat in MAT_ORDER:
            if mat not in part.prims or not part.prims[mat]['p']: continue
            P = np.array(part.prims[mat]['p'], np.float32); Nn = np.array(part.prims[mat]['n'], np.float32); cnt = len(P)
            idx = np.arange(cnt, dtype=np.uint16)
            vp = add_view(P.tobytes(), 34962); vn = add_view(Nn.tobytes(), 34962); vi = add_view(idx.tobytes(), 34963)
            accs.append({'bufferView': vp, 'componentType': 5126, 'count': cnt, 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()}); a_p = len(accs) - 1
            accs.append({'bufferView': vn, 'componentType': 5126, 'count': cnt, 'type': 'VEC3'}); a_n = len(accs) - 1
            accs.append({'bufferView': vi, 'componentType': 5123, 'count': cnt, 'type': 'SCALAR'}); a_i = len(accs) - 1
            attrs = {'POSITION': a_p, 'NORMAL': a_n}
            if part.prims[mat].get('uv'):
                U = np.array(part.prims[mat]['uv'], np.float32); vu = add_view(U.tobytes(), 34962)
                accs.append({'bufferView': vu, 'componentType': 5126, 'count': cnt, 'type': 'VEC2'}); attrs['TEXCOORD_0'] = len(accs) - 1
            prims.append({'attributes': attrs, 'indices': a_i, 'material': MAT_ORDER.index(mat), 'mode': 4})
        meshes.append({'name': name, 'primitives': prims}); return len(meshes) - 1
    mh, mt, mg = mesh_of(hull, 'hull'), mesh_of(tur, 'turret'), mesh_of(gun, 'gun')
    extra_nodes = []
    for nm, part, kk in tracks: extra_nodes.append({'name': nm, 'mesh': mesh_of(part, nm), 'extras': {'k': float(kk)}})
    for nm, part, t, r in wheels: extra_nodes.append({'name': nm, 'mesh': mesh_of(part, nm), 'translation': [float(v) for v in t], 'extras': {'r': float(r)}})
    gloc = [gpos[0] - tpos[0], gpos[1] - tpos[1], gpos[2] - tpos[2]]
    js = {'asset': {'version': '2.0', 'generator': 'Tanks3D gen_models.py'}, 'scene': 0, 'scenes': [{'nodes': [0, 1]}],
          'nodes': [{'name': 'hull', 'mesh': mh, 'children': list(range(4, 4 + len(extra_nodes)))}, {'name': 'turret', 'mesh': mt, 'translation': [float(v) for v in tpos], 'children': [2]},
                    {'name': 'gun', 'mesh': mg, 'translation': [float(v) for v in gloc], 'children': [3]}, {'name': 'muzzle', 'translation': [0.0, 0.0, float(gl)]}] + extra_nodes,
          'meshes': meshes, 'materials': [{'name': m, 'pbrMetallicRoughness': {'baseColorFactor': MATS[m], 'metallicFactor': 0.0, 'roughnessFactor': 1.0}} for m in MAT_ORDER],
          'accessors': accs, 'bufferViews': bviews, 'buffers': [{'byteLength': len(bin_)}]}
    jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4)
    while len(bin_) % 4: bin_.append(0)
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bytes(bin_))
    return total

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'models'; os.makedirs(out, exist_ok=True); files = []
    for nat in NAT:
        for cls in ('light', 'medium', 'heavy'):
            fn = f'{nat}_{cls}.glb'; sz = write_glb(os.path.join(out, fn), *build_tracked(cls, nat)); files.append(fn)
        fn = f'{nat}_wheeled.glb'; sz = write_glb(os.path.join(out, fn), *build_wheeled(nat)); files.append(fn)
    json.dump({'files': files}, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    print(len(files), 'models ->', out)
