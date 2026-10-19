# Heft art pipeline — the island: heightfield terrain, resource spawns, camp anchors and baked decor.
# The heightfield is exported as int16 centimetres (base64) on the terrain node so the game samples the exact surface.
import bpy, bmesh, math, random, json, base64, struct
from mathutils import Vector, noise
from core import Mesh, coll, gv, srgb, lin, to_lin, clamp, sstep, mix, fbm, TAU, mats

SIZE, N = 104.0, 131                     # terrain covers [-52, 52]; 0.8 m cells
STEP = SIZE / (N - 1)
PEAK, PEAK_H = (15.0, -16.0), 9.2
QUARRY = (-20.0, -5.0)
POND = (-13.0, 15.0)
FORD = (19.6, 8.0)
CAMP = {'hearth': (0, 0, 0), 'tent': (-4.4, -4.6, 0.55), 'flag': (3.8, -3.9, 0), 'woodrack': (-5.4, 0.9, 1.45),
        'stonebin': (-3.6, 4.6, -0.55), 'start': (1.6, 4.2, 0)}
RIVER = [(31, -9), (27, -1), (21.5, 5.5), (17.5, 11), (14, 18), (11, 26), (8.5, 35), (7, 45), (6, 58)]
THETA0 = math.atan2(0 - PEAK[1], 0 - PEAK[0])
SPIRAL = [(PEAK[0] + (12 - 9.5 * t) * math.cos(THETA0 + t * TAU), PEAK[1] + (12 - 9.5 * t) * math.sin(THETA0 + t * TAU))
          for t in [i / 80 for i in range(81)]]
PATHS = [
    [(0, 0), (4, -3.6), SPIRAL[0]],                                       # camp -> mountain road
    [(0, 0), (-7, -1), (-13, -3), (-16, -4.5), (-19, -5)],                   # quarry road
    [(0, 0), (7, 3), (13, 6), FORD, (25, 9), (31, 11)],                    # east road over the ford
    [(0, 0), (-2, 7), (-6, 12), (-9.5, 15.5)],                             # pond trail
    [(0, 0), (-1.5, -7), (-3.5, -15), (-4, -24), (-2, -31)],               # north trail into the pines
]


def near_seg(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = clamp(((px - ax) * dx + (pz - az) * dz) / L2) if L2 else 0
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), qx, qz


def near_poly(px, pz, pts):
    best = (1e9, 0, 0)
    for a, b in zip(pts, pts[1:]):
        r = near_seg(px, pz, a[0], a[1], b[0], b[1])
        if r[0] < best[0]:
            best = r
    return best


def terrace(h, s, sharp=0.72):
    k = h / s
    fl = math.floor(k)
    return (fl + sstep(sharp, 1.0, k - fl)) * s


def coast(x, z):
    a = math.atan2(z, x)
    R = 41 + 4.5 * fbm(math.cos(a) * 1.4, math.sin(a) * 1.4, 3, 11.0)
    return math.hypot(x, z) / R


def smooth_parts(x, z):
    """Land, mountain and quarry heights before terracing."""
    dc = math.hypot(x, z)
    land = 0.55 + (0.5 + 1.2 * fbm(x / 17, z / 17, 4, 3.0)) * sstep(9, 19, dc) + 0.25 * fbm(x / 5, z / 5, 2, 5.0) * sstep(7, 13, dc)
    dm = math.hypot(x - PEAK[0], z - PEAK[1])
    mtn = PEAK_H * (1 - sstep(2.5, 14, dm)) + 0.5 * fbm(x / 4, z / 4, 2, 8.0) * sstep(2, 6, dm) * (1 - sstep(12, 15, dm))
    dq = math.hypot(x - QUARRY[0], z - QUARRY[1])
    qry = 3.6 * (1 - sstep(1.5, 11, dq)) + 0.35 * fbm(x / 3, z / 3, 2, 9.0) * (1 - sstep(8, 12, dq))
    return land, max(mtn, 0.0), max(qry, 0.0)


def height_raw(x, z):
    land, mtn, qry = smooth_parts(x, z)
    terr = land + terrace(mtn, 2.3) + terrace(qry, 1.8, 0.7)
    # roads: level across their width, following the un-terraced slope along their centreline
    road = 0.0
    for pts in PATHS + [SPIRAL]:
        d, qx, qz = near_poly(x, z, pts)
        w = 1 - sstep(1.4, 3.0, d)
        if w > road:
            l2, m2, q2 = smooth_parts(qx, qz)
            hc = l2 + m2 + q2
            road = w
            road_h = hc
    h = terr if road == 0 else terr + (road_h - terr) * road
    # river, ford, spring and pond
    rd = near_poly(x, z, RIVER)[0]
    bed = -0.55 if math.hypot(x - FORD[0], z - FORD[1]) > 2.6 else -0.12
    h = bed + (h - bed) * sstep(1.1, 3.6, rd)
    dp = math.hypot(x - POND[0], z - POND[1])
    h = -0.75 + (h + 0.75) * sstep(2.6, 5.4, dp)
    # coastline: beach shelf then the sea floor
    u = coast(x, z)
    w = 1 - sstep(0.8, 0.93, u)
    h = h * w + 0.22 * (1 - w)
    h -= 2.8 * sstep(0.93, 1.06, u)
    return h


def path_dist(x, z):
    return min(near_poly(x, z, p)[0] for p in PATHS + [SPIRAL])


# ---------------------------------------------------------------- heightfield
class Field:
    def __init__(self):
        self.h = [[height_raw(-SIZE / 2 + i * STEP, -SIZE / 2 + j * STEP) for i in range(N)] for j in range(N)]

    def at(self, x, z):
        fx, fz = (x + SIZE / 2) / STEP, (z + SIZE / 2) / STEP
        i, j = int(clamp(math.floor(fx), 0, N - 2)), int(clamp(math.floor(fz), 0, N - 2))
        fx, fz = clamp(fx - i), clamp(fz - j)
        h = self.h
        h00, h10, h01, h11 = h[j][i], h[j][i + 1], h[j + 1][i], h[j + 1][i + 1]
        if fx > fz:
            return h00 + (h10 - h00) * fx + (h11 - h10) * fz
        return h00 + (h11 - h01) * fx + (h01 - h00) * fz

    def slope(self, x, z, e=0.5):
        return math.hypot(self.at(x + e, z) - self.at(x - e, z), self.at(x, z + e) - self.at(x, z - e)) / (2 * e)

    def packed(self):
        vals = [int(round(clamp(v, -30, 30) * 100)) for row in self.h for v in row]
        return base64.b64encode(struct.pack('<%dh' % len(vals), *vals)).decode()


def forest(x, z):
    f = fbm(x / 11, z / 11, 3, 21.0) * 0.5 + 0.5
    if z < -10:
        f += 0.22
    if x > 22 and z > -2:
        f += 0.12
    f -= 0.45 * (1 - sstep(7, 11, math.hypot(x - QUARRY[0], z - QUARRY[1])))
    return f - 0.55 * (1 - sstep(9, 13, math.hypot(x, z)))


def ground_colour(F, x, z, hgt, slope, pd):
    g1, g2, g3 = srgb(0x86b44c), srgb(0x5d9440), srgb(0xb2bd58)
    n = fbm(x / 6, z / 6, 3, 31.0)
    c = mix(g1, g2, clamp(0.5 + n * 1.3))
    c = mix(c, g3, clamp(fbm(x / 13, z / 13, 2, 37.0) * 2.2 - 0.25) * 0.55)
    fo = clamp((forest(x, z) - 0.5) * 3)
    c = mix(c, mix(srgb(0x4b7434), srgb(0x6b5b3a), clamp(0.5 + fbm(x / 2.5, z / 2.5, 2, 41.0))), fo * 0.75)
    if hgt > 3.5:
        c = mix(c, srgb(0x93a557), clamp((hgt - 3.5) / 5) * 0.6)
    road = 1 - sstep(0.6, 1.6 + 0.4 * fbm(x / 2, z / 2, 2, 43.0), pd)
    c = mix(c, mix(srgb(0xb48e5c), srgb(0x9b7a52), clamp(0.5 + fbm(x, z, 2, 47.0))), road)
    sand = max(1 - sstep(0.25, 0.42, hgt), sstep(0.76, 0.84, coast(x, z)))
    c = mix(c, srgb(0xe3d09c), sand)
    if hgt < -0.05:
        c = mix(srgb(0xd7c693), srgb(0x6f8c7c), clamp(-hgt / 1.6))
    cliff = sstep(0.75, 1.25, slope)
    band = 0.5 + 0.5 * math.sin(hgt * 5.5 + fbm(x / 3, z / 3, 2, 53.0) * 2)
    rock = mix(srgb(0x8f877b), srgb(0x6e675e), band * 0.8)
    c = mix(c, rock, cliff)
    k = 0.94 + 0.12 * fbm(x * 1.3, z * 1.3, 1, 59.0)
    return [v * k for v in c]


def build_terrain(c, F):
    verts, faces = [], []
    for j in range(N):
        for i in range(N):
            verts.append(gv(-SIZE / 2 + i * STEP, F.h[j][i], -SIZE / 2 + j * STEP))
    for j in range(N - 1):
        for i in range(N - 1):
            a, b, cc, d = j * N + i, j * N + i + 1, (j + 1) * N + i + 1, (j + 1) * N + i
            faces.append((a, cc, b))   # split along (i,j)-(i+1,j+1), matching Field.at
            faces.append((a, d, cc))
    me = bpy.data.meshes.get('terrain') or bpy.data.meshes.new('terrain')
    me.clear_geometry()
    me.from_pydata(verts, [], faces)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for j in range(N):
        for i in range(N):
            x, z = -SIZE / 2 + i * STEP, -SIZE / 2 + j * STEP
            hgt = F.h[j][i]
            cc = ground_colour(F, x, z, hgt, F.slope(x, z), path_dist(x, z) if abs(x) < 40 and abs(z) < 44 else 99)
            col.data[j * N + i].color = to_lin(cc)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    me.materials.clear()
    me.materials.append(mats()['Base'])
    me.update()
    ob = bpy.data.objects.get('terrain') or bpy.data.objects.new('terrain', me)
    if ob.name not in c.objects:
        c.objects.link(ob)
    return ob


# ---------------------------------------------------------------- spawns
def scatter(F, seed=7):
    rnd = random.Random(seed)
    out, taken = [], []

    def free(x, z, r):
        return all((x - a) ** 2 + (z - b) ** 2 > (r + rb) ** 2 for a, b, rb in taken)

    def put(kind, var, x, z, r):
        out.append([kind, var, round(x, 2), round(z, 2), round(rnd.random() * TAU, 2), round(0.85 + rnd.random() * 0.35, 2)])
        taken.append((x, z, r))

    def ok_ground(x, z, pd_min=2.2):
        h = F.at(x, z)
        return h > 0.4 and F.slope(x, z) < 0.55 and coast(x, z) < 0.88 and path_dist(x, z) > pd_min

    # starter wood and stone just outside camp so the first steps are short
    for a in (0.5, 1.4, 2.1, 3.9, 4.6, 5.5):
        x, z = math.cos(a) * 9.5, math.sin(a) * 9.5
        if ok_ground(x, z, 1.8) and free(x, z, 1.2):
            put('tree', 1, x, z, 1.1)
    for a in (2.9, 3.3, 5.0):
        x, z = math.cos(a) * 10.5, math.sin(a) * 10.5
        if ok_ground(x, z, 1.8) and free(x, z, 1.4):
            put('rock', 0, x, z, 1.2)
    # stone: the quarry hill, cliff feet, a few strays
    for _ in range(4000):
        x, z = rnd.uniform(-44, 44), rnd.uniform(-44, 44)
        dq = math.hypot(x - QUARRY[0], z - QUARRY[1])
        p = 0.5 if dq < 11 else 0.06 if F.slope(x + 1.5, z) > 0.9 or F.slope(x - 1.5, z) > 0.9 else 0.012
        if rnd.random() < p and ok_ground(x, z, 1.8) and free(x, z, 1.5) and math.hypot(x, z) > 9:
            put('rock', rnd.randrange(2), x, z, 1.3)
    # ember shards: flat ledges high on the mountain and the far north hollow
    tries = 0
    while sum(1 for o in out if o[0] == 'ember') < 18 and tries < 20000:
        tries += 1
        x, z = rnd.uniform(-44, 44), rnd.uniform(-44, 44)
        hi = F.at(x, z) > 3.0 and math.hypot(x - PEAK[0], z - PEAK[1]) > 4.5
        north = z < -30 and coast(x, z) < 0.86
        if (hi or north) and ok_ground(x, z, 2.0) and free(x, z, 2.6):
            put('ember', 0, x, z, 1.0)
    # forests
    g = 2.3
    for j in range(-44, 45):
        for i in range(-44, 45):
            x, z = i * g / 2 + rnd.uniform(-0.7, 0.7), j * g / 2 + rnd.uniform(-0.7, 0.7)
            if (i + j) % 2 or not ok_ground(x, z):
                continue
            f = forest(x, z)
            if rnd.random() > sstep(0.32, 0.62, f) * 0.9 or not free(x, z, 1.05):
                continue
            h = F.at(x, z)
            if z < -9 or h > 2.6 or rnd.random() < 0.15:
                var = 0
            elif x > 16 or (z > 12 and rnd.random() < 0.55) or rnd.random() < 0.18:
                var = 2
            else:
                var = 1
            put('tree', var, x, z, 1.05)
    return out


# ---------------------------------------------------------------- decor (one merged mesh)
def build_decor(c, F, spawns, ao=None, seed=5):
    rnd = random.Random(seed)
    m = Mesh(seed=seed)
    blocked = [(s[2], s[3], 0.8 if s[0] == 'tree' else 1.0) for s in spawns]
    camp_props = [(v[0], v[1]) for v in CAMP.values()]

    def clear_of(x, z):
        if any((x - a) ** 2 + (z - b) ** 2 < r * r for a, b, r in blocked):
            return False
        if math.hypot(x, z) < 2.6:
            return False
        return all((x - a) ** 2 + (z - b) ** 2 > 2.4 for a, b in camp_props)

    def shade(x, z):
        return ao(x, z) if ao else 1.0

    def blade(x, z, h, w, a, lean, cb, ct, y):
        dx, dz = math.cos(a) * w, math.sin(a) * w
        tx, tz = x + math.cos(a + 1.57) * lean, z + math.sin(a + 1.57) * lean
        m.tri([(x - dx, y, z - dz), (x + dx, y, z + dz), (tx, y + h, tz)], [cb, cb, ct], sway=[0, 0, 1])

    for _ in range(26000):
        x, z = rnd.uniform(-44, 44), rnd.uniform(-44, 44)
        h = F.at(x, z)
        if h < 0.45 or coast(x, z) > 0.86 or F.slope(x, z) > 0.7:
            continue
        pd = path_dist(x, z)
        fo = forest(x, z)
        if pd < 1.2 or not clear_of(x, z):
            continue
        k = shade(x, z)
        if fo > 0.62 and rnd.random() < 0.25:   # fern
            base = [v * k * 0.8 for v in srgb(0x3f6a2c)]
            tip = [v * k for v in srgb(0x6ea040)]
            for f in range(6):
                a = f / 6 * TAU + rnd.random()
                L = 0.45 + rnd.random() * 0.2
                ex, ez = x + math.cos(a) * L, z + math.sin(a) * L
                px, pz = math.cos(a + 1.57) * 0.09, math.sin(a + 1.57) * 0.09
                m.tri([(x, h, z), (ex + px, h + 0.32, ez + pz), (ex - px, h + 0.3, ez - pz)], [base, tip, tip], sway=[0, 0.7, 0.7])
            continue
        if fo > 0.55 and rnd.random() > 0.35:
            continue
        r = rnd.random()
        if r < 0.86:   # grass tuft
            g = srgb([0x7fae46, 0x6c9e3c, 0x92b851, 0xa4b956][rnd.randrange(4)])
            base = [v * k * 0.62 for v in g]
            tip = [v * k * 1.12 for v in g]
            for b in range(5):
                a = rnd.random() * TAU
                ox, oz = math.cos(a) * 0.08, math.sin(a) * 0.08
                blade(x + ox, z + oz, 0.22 + rnd.random() * 0.2, 0.035, a, 0.05 + rnd.random() * 0.06, base, tip, h - 0.02)
        elif r < 0.96:  # flower
            col = srgb([0xf4f0e6, 0xf5d24a, 0xb47ad6, 0xe8584a, 0x7fa8e8][rnd.randrange(5)])
            stem = [v * k for v in srgb(0x5e8c3a)]
            sh = 0.22 + rnd.random() * 0.14
            blade(x, z, sh, 0.012, rnd.random() * TAU, 0.0, stem, stem, h - 0.02)
            for p in range(4):
                a = p / 4 * TAU
                m.tri([(x, h + sh, z), (x + math.cos(a) * 0.07, h + sh + 0.025, z + math.sin(a) * 0.07),
                       (x + math.cos(a + 1.2) * 0.07, h + sh + 0.025, z + math.sin(a + 1.2) * 0.07)],
                      [[v * 0.8 for v in col], col, col], sway=[1, 1, 1])
        else:            # bush
            g = 0x5c8f3a if rnd.random() < 0.7 else 0x4d7d34
            m.add('ico', (0.42 + rnd.random() * 0.2, 1), g, x=x, y=h + 0.18, z=z, sy=0.7, jit=0.08, grad=0.55, top=0.15, var=0.06,
                  sway=(h, h + 0.7, 0.35))
            if rnd.random() < 0.5:
                for b in range(4):
                    a = rnd.random() * TAU
                    m.add('ico', (0.05, 0), 0xd8402e, x=x + math.cos(a) * 0.38, y=h + 0.28, z=z + math.sin(a) * 0.3, grad=0)
    # reeds on wet banks
    for _ in range(9000):
        x, z = rnd.uniform(-44, 44), rnd.uniform(-44, 44)
        h = F.at(x, z)
        if -0.25 < h < 0.38 and coast(x, z) < 0.86 and clear_of(x, z):
            base = srgb(0x5e7a3a)
            tip = srgb(0xa9b86a)
            for b in range(4):
                blade(x + rnd.uniform(-0.1, 0.1), z + rnd.uniform(-0.1, 0.1), 0.55 + rnd.random() * 0.45, 0.025, rnd.random() * TAU,
                      0.08, base, tip, h - 0.05)
            if rnd.random() < 0.2:
                m.add('cyl', (0.035, 0.035, 0.16, 6), 0x6a4328, x=x, y=h + 0.95, z=z, sway=1.0, grad=0)
    # pebbles along roads and the beach
    for _ in range(7000):
        x, z = rnd.uniform(-46, 46), rnd.uniform(-46, 46)
        h = F.at(x, z)
        if h < 0.05:
            continue
        if path_dist(x, z) < 1.4 or (h < 0.45 and rnd.random() < 0.4):
            if clear_of(x, z) and rnd.random() < 0.35:
                m.add('ico', (0.05 + rnd.random() * 0.06, 0), [0x9a948a, 0xb5ae9f, 0x7f796f][rnd.randrange(3)], x=x, y=h + 0.01, z=z, sy=0.5,
                      grad=0.2)
    # boulders at the feet of cliffs (not harvestable)
    for _ in range(9000):
        x, z = rnd.uniform(-44, 44), rnd.uniform(-44, 44)
        h = F.at(x, z)
        if h > 0.3 and F.slope(x, z) < 0.5 and max(F.slope(x + 1.2, z), F.slope(x - 1.2, z), F.slope(x, z + 1.2), F.slope(x, z - 1.2)) > 1.0:
            if rnd.random() < 0.18 and clear_of(x, z) and path_dist(x, z) > 2.0:
                r = 0.3 + rnd.random() * 0.45
                m.add('ico', (r, 1), [0x8b857a, 0x9d978b, 0x77716a][rnd.randrange(3)], x=x, y=h + r * 0.3, z=z, sy=0.7, jit=r * 0.18,
                      grad=0.5, moss=0x6e9a45)
    # lily pads, ford stepping stones, fallen logs, mushrooms
    for i in range(16):
        a, d = rnd.random() * TAU, rnd.random() * 2.8
        x, z = POND[0] + math.cos(a) * d, POND[1] + math.sin(a) * d
        m.add('cyl', (0.22, 0.22, 0.02, 9), 0x5f9a42, x=x, y=0.02, z=z, ry=a, grad=0, var=0.08)
        if i % 4 == 0:
            m.add('ico', (0.06, 1), 0xf3c6d8, x=x, y=0.07, z=z, sy=0.6, grad=0)
    for i in range(6):
        t = (i - 2.5) / 2.5
        x, z = FORD[0] + t * 1.9 + rnd.uniform(-0.2, 0.2), FORD[1] + t * 0.6 + rnd.uniform(-0.2, 0.2)
        m.add('cyl', (0.36, 0.42, 0.22, 8), 0xa29b8d, x=x, y=0.0, z=z, jit=0.04, grad=0.3, moss=0x6e9a45)
    for (x, z, a) in ((-9, -18, 0.4), (12, -2, 2.0), (-20, 10, 1.1), (27, 16, 2.6), (-14, -27, 0.2), (3, 21, 1.7)):
        h = F.at(x, z)
        if h > 0.3:
            m.add('cyl', (0.2, 0.24, 2.4, 9), 0x6a4328, x=x, y=h + 0.18, z=z, rz=math.pi / 2, ry=a, cap=0xd8b07a, jit=0.03, moss=0x6e9a45)
    for _ in range(1600):
        x, z = rnd.uniform(-40, 40), rnd.uniform(-44, 10)
        if forest(x, z) > 0.7 and rnd.random() < 0.3:
            h = F.at(x, z)
            if h > 0.5 and clear_of(x, z):
                cap = 0xd8402e if rnd.random() < 0.6 else 0xc79a5c
                m.add('cyl', (0.025, 0.03, 0.12, 5), 0xefe6d2, x=x, y=h + 0.05, z=z, grad=0)
                m.add('cyl', (0.0, 0.09, 0.07, 7), cap, x=x, y=h + 0.13, z=z, grad=0)
    return m.finish('decor', c)


def build_island(c):
    F = Field()
    terrain = build_terrain(c, F)
    spawns = scatter(F)
    peak_h = F.at(*PEAK)
    anchors = {k: [v[0], round(F.at(v[0], v[1]), 3), v[1], v[2]] for k, v in CAMP.items()}
    anchors['beacon'] = [PEAK[0], round(peak_h, 3), PEAK[1], 0.0]
    anchors['ford'] = [FORD[0], 0, FORD[1], 0]
    terrain['heft_grid'] = json.dumps({'size': SIZE, 'n': N})
    terrain['heft_heights'] = F.packed()
    terrain['heft_spawns'] = json.dumps(spawns, separators=(',', ':'))
    terrain['heft_anchors'] = json.dumps(anchors, separators=(',', ':'))
    return F, terrain, spawns, anchors


# ---------------------------------------------------------------- Blender-only preview (linked duplicates, never exported)
KIND = {('tree', 0): 'tree_pine', ('tree', 1): 'tree_oak', ('tree', 2): 'tree_birch', ('rock', 0): 'rock_a', ('rock', 1): 'rock_b',
        ('ember', 0): 'ember'}
PROPS = {'hearth': ['hearth_ring', 'hearth', 'flame'], 'tent': ['tent'], 'flag': ['flagpole', 'flag_cloth'], 'woodrack': ['woodrack'],
         'stonebin': ['stonebin'], 'beacon': ['beacon'], 'start': ['builder']}


def place(c, src, x, y, z, rot=0.0, s=1.0):
    src_ob = bpy.data.objects[src]
    ob = src_ob.copy()
    c.objects.link(ob)
    ob.parent = None
    ob.location = gv(x, y, z) + (src_ob.location - bpy.data.objects[PROPS_ROOT.get(src, src)].location)
    ob.rotation_euler = (0, 0, rot)
    ob.scale = (s, s, s)
    def kids(src, dst):
        for ch in src.children:
            k = ch.copy()
            c.objects.link(k)
            k.parent = dst
            kids(ch, k)
    kids(src_ob, ob)
    return ob


PROPS_ROOT = {'flag_cloth': 'flagpole'}


def preview(F, spawns, anchors):
    c = coll('HeftPreview')
    for kind, var, x, z, rot, s in spawns:
        place(c, KIND[(kind, var)], x, F.at(x, z) - 0.05, z, rot, s)
    for k, names in PROPS.items():
        x, y, z, rot = anchors[k]
        for n in names:
            place(c, n, x, y, z, rot)
    return c


# ---------------------------------------------------------------- ambient occlusion baked into the vertex colours
def bake_ao(objs, distance=1.2, strength=0.75, samples=48):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'CYCLES'
    except TypeError:
        pass
    sc.cycles.samples = samples
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world.light_settings.distance = distance
    for ob in objs:
        me = ob.data
        dom = me.color_attributes['Col'].domain
        ao = me.color_attributes.get('AO') or me.color_attributes.new('AO', 'FLOAT_COLOR', dom)
        me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO')
        col, ao = me.color_attributes['Col'], me.color_attributes['AO']
        n = len(col.data)
        a, b = [0.0] * n * 4, [0.0] * n * 4
        col.data.foreach_get('color', a)
        ao.data.foreach_get('color', b)
        for i in range(n):
            k = 1 - strength * (1 - b[i * 4])
            a[i * 4], a[i * 4 + 1], a[i * 4 + 2] = a[i * 4] * k, a[i * 4 + 1] * k, a[i * 4 + 2] * k
        col.data.foreach_set('color', a)
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        if ob.name == 'terrain':
            ob['ao'] = b[0::4]  # kept on the object only to shade decor; stripped before export


def ao_sampler(terrain):
    vals = list(terrain['ao'])
    def at(x, z):
        fx, fz = (x + SIZE / 2) / STEP, (z + SIZE / 2) / STEP
        i, j = int(clamp(round(fx), 0, N - 1)), int(clamp(round(fz), 0, N - 1))
        return 0.35 + 0.65 * vals[j * N + i]
    return at
