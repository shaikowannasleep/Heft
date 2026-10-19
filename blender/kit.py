# Heft art pipeline — props, resources, camp, builder and gloomwolf. Each builder returns the root object.
# Object names are the contract with the game (heft2.html looks them up by name).
import math
from core import Mesh, empty, TAU

BARK, BARK_D, WOOD, WOOD_L, CUT = 0x6e4628, 0x4f321d, 0x9a6a3e, 0xc4955c, 0xeac58e
STONE, STONE_D, STONE_L, MOSS = 0x958f84, 0x6f6a62, 0xb8b2a5, 0x6e9a45
IRON, IRON_D, ROPE, CANVAS = 0x5b5e63, 0x34363a, 0xd2b47c, 0xe0cfa6


def leafball(m, r, x, y, z, cols, seed, sub=2, sx=1.0, sy=0.85, sz=1.0, top_y=4.0):
    m.add('ico', (r, sub), cols[seed % len(cols)], x=x, y=y, z=z, sx=sx, sy=sy, sz=sz, jit=r * 0.16, var=0.07, grad=0.55,
          top=0.16, hue=0.04, sway=(0.9, top_y, 1.0))


def tree_pine(c, loc):
    m = Mesh(seed=11)
    m.add('cyl', (0.13, 0.26, 1.7, 7), BARK, y=0.85, jit=0.025, grad=0.5, sway=(0.9, 4.8, 1.0))
    for i in range(4):
        a = i / 4 * TAU + 0.4
        m.add('cyl', (0.03, 0.11, 0.55, 5), BARK_D, x=math.cos(a) * 0.2, y=0.1, z=math.sin(a) * 0.2, rz=-math.cos(a) * 1.15,
              rx=math.sin(a) * 1.15, grad=0.2)
    tiers = [(1.45, 1.55, 1.45, 0x2c5f38), (1.18, 1.35, 2.2, 0x336d3d), (0.92, 1.2, 2.9, 0x3d7c44), (0.62, 1.05, 3.55, 0x4a8c4a),
             (0.34, 0.8, 4.15, 0x5a9c52)]
    for i, (r, h, y, col) in enumerate(tiers):
        m.add('cyl', (0.0, r, h, 9), col, y=y, ry=i * 0.7, jit=0.09, var=0.06, grad=0.6, top=0.12, sway=(0.9, 4.8, 1.0))
    return m.finish('tree_pine', c, loc)


def tree_oak(c, loc):
    m = Mesh(seed=23)
    m.add('cyl', (0.17, 0.3, 1.8, 8), BARK, y=0.9, jit=0.03, grad=0.5, sway=(0.9, 4.2, 1.0))
    m.add('cyl', (0.05, 0.1, 1.0, 6), BARK, x=0.32, y=1.85, rz=-0.75, grad=0.3, sway=(0.9, 4.2, 1.0))
    m.add('cyl', (0.05, 0.1, 0.9, 6), BARK, x=-0.28, y=1.9, z=0.1, rz=0.8, grad=0.3, sway=(0.9, 4.2, 1.0))
    for i in range(4):
        a = i / 4 * TAU + 0.2
        m.add('cyl', (0.04, 0.13, 0.5, 5), BARK_D, x=math.cos(a) * 0.24, y=0.1, z=math.sin(a) * 0.24, rz=-math.cos(a) * 1.2,
              rx=math.sin(a) * 1.2, grad=0.2)
    greens = [0x5f9a3c, 0x6fac46, 0x4f8a36, 0x7cb851]
    balls = [(1.05, 0, 2.85, 0), (0.8, 0.85, 2.5, 0.25), (0.78, -0.8, 2.6, -0.2), (0.72, 0.2, 2.45, 0.85), (0.7, -0.15, 2.5, -0.8),
             (0.65, 0.35, 3.45, 0.2), (0.55, -0.4, 3.35, -0.3)]
    for i, (r, x, y, z) in enumerate(balls):
        leafball(m, r, x, y, z, greens, i, top_y=4.2)
    return m.finish('tree_oak', c, loc)


def tree_birch(c, loc):
    m = Mesh(seed=37)
    m.add('cyl', (0.09, 0.16, 2.4, 7), 0xe9e2d2, y=1.2, jit=0.02, grad=0.25, sway=(0.9, 4.4, 1.0))
    for i, (y, a) in enumerate([(0.5, 0.2), (0.95, 2.3), (1.4, 4.1), (1.85, 1.1), (2.2, 3.3)]):
        m.add('box', (0.1, 0.04, 0.05), 0x3a3230, x=math.cos(a) * 0.12, y=y, z=math.sin(a) * 0.12, ry=-a, grad=0, sway=(0.9, 4.4, 1.0))
    m.add('cyl', (0.04, 0.07, 0.8, 5), 0xe0d8c6, x=0.25, y=2.3, rz=-0.7, sway=(0.9, 4.4, 1.0))
    golds = [0xe6852c, 0xf0ad45, 0xd4612a, 0xf5c55a]
    balls = [(0.8, 0, 3.0, 0), (0.62, 0.62, 2.7, 0.2), (0.6, -0.55, 2.75, -0.25), (0.55, 0.1, 2.6, 0.62), (0.5, 0, 3.6, 0.1),
             (0.5, -0.2, 2.65, -0.6)]
    for i, (r, x, y, z) in enumerate(balls):
        leafball(m, r, x, y, z, golds, i, top_y=4.2)
    return m.finish('tree_birch', c, loc)


def stump(c, loc):
    m = Mesh(seed=5)
    m.add('cyl', (0.22, 0.3, 0.36, 9), BARK, y=0.18, jit=0.02, cap=CUT, grad=0.5)
    m.add('cyl', (0.13, 0.13, 0.01, 9), 0xd2a66c, y=0.365, grad=0)
    for i in range(3):
        a = i / 3 * TAU + 0.5
        m.add('cyl', (0.03, 0.1, 0.4, 5), BARK_D, x=math.cos(a) * 0.25, y=0.06, z=math.sin(a) * 0.25, rz=-math.cos(a) * 1.25,
              rx=math.sin(a) * 1.25)
    for i in range(4):
        a = i * 1.7
        m.add('box', (0.09, 0.03, 0.05), CUT, x=math.cos(a) * 0.5, y=0.015, z=math.sin(a) * 0.45, ry=a, grad=0)
    return m.finish('stump', c, loc)


def rock_a(c, loc):
    m = Mesh(seed=41)
    m.add('ico', (0.72, 2), STONE, y=0.42, sx=1.25, sy=0.78, jit=0.17, grad=0.5, top=0.12, moss=MOSS)
    m.add('ico', (0.45, 1), STONE_L, x=0.7, y=0.24, z=0.3, sy=0.8, jit=0.1, grad=0.5, moss=MOSS)
    m.add('ico', (0.3, 1), STONE_D, x=-0.75, y=0.15, z=-0.25, jit=0.08, grad=0.4)
    return m.finish('rock_a', c, loc)


def rock_b(c, loc):
    m = Mesh(seed=53)
    m.add('ico', (0.55, 1), 0x8b867d, y=0.4, sy=1.15, jit=0.12, grad=0.55, moss=MOSS)
    m.add('ico', (0.42, 1), STONE_L, x=-0.5, y=0.3, z=0.28, rz=0.3, jit=0.1, grad=0.5, moss=MOSS)
    m.add('ico', (0.32, 1), STONE, x=0.42, y=0.2, z=-0.4, jit=0.09, grad=0.5)
    m.add('ico', (0.16, 1), STONE_D, x=0.55, y=0.08, z=0.35, grad=0.3)
    return m.finish('rock_b', c, loc)


def rubble(c, loc):
    m = Mesh(seed=7)
    for i, (x, z, r) in enumerate([(0.3, 0.1, 0.18), (-0.25, 0.2, 0.15), (0.05, -0.3, 0.13), (-0.1, -0.05, 0.1)]):
        m.add('ico', (r, 1), [STONE, STONE_L, STONE_D][i % 3], x=x, y=r * 0.5, z=z, sy=0.6, jit=0.03)
    return m.finish('rubble', c, loc)


def crystal(m, x, z, length, r, tx, tz, col, base_y=0.25):
    m.add('cyl', (r * 0.9, r, length, 6), col, x=x, y=base_y + length / 2, z=z, rx=tx, rz=tz, glow=True, grad=0.5, top=0.0, var=0.08)
    # tip: offset along the tilted axis
    import mathutils
    d = mathutils.Euler((tx, 0, tz), 'ZYX').to_matrix() @ mathutils.Vector((0, length / 2 + r * 0.6, 0))
    m.add('cyl', (0.0, r * 0.9, r * 1.2, 6), 0xffe3a0, x=x + d.x, y=base_y + length / 2 + d.y, z=z + d.z, rx=tx, rz=tz, glow=True, grad=0.3)


def ember(c, loc):
    m = Mesh(seed=61)
    m.add('ico', (0.55, 1), 0x3e3442, y=0.2, sx=1.2, sy=0.55, jit=0.1, grad=0.4)
    m.add('ico', (0.3, 1), 0x4b3f4e, x=0.45, y=0.12, z=0.3, sy=0.6, jit=0.06)
    crystal(m, 0, 0, 0.95, 0.15, 0.08, 0.12, 0xff8a33)
    crystal(m, 0.28, 0.05, 0.7, 0.12, 0.1, -0.5, 0xffb347)
    crystal(m, -0.26, 0.1, 0.62, 0.11, -0.2, 0.55, 0xff6a2a)
    crystal(m, 0.05, -0.27, 0.5, 0.1, -0.55, 0.0, 0xffc45a)
    crystal(m, -0.1, 0.3, 0.42, 0.08, 0.6, 0.2, 0xff9a3a)
    return m.finish('ember', c, loc)


# ---------------------------------------------------------------- carried items
def item_log(c, loc):
    m = Mesh(seed=3)
    m.add('cyl', (0.13, 0.13, 0.72, 9), 0x87552f, rz=math.pi / 2, cap=CUT, bevel=0.025, jit=0.01, grad=0.0, top=0.12)
    m.add('cyl', (0.06, 0.06, 0.725, 9), 0xd8aa6d, rz=math.pi / 2, grad=0, top=0)
    m.add('box', (0.08, 0.05, 0.05), BARK_D, x=0.1, y=0.12, rz=0.3, grad=0)
    return m.finish('item_log', c, loc)


def item_stone(c, loc):
    m = Mesh(seed=9)
    m.add('box', (0.44, 0.28, 0.36), 0xa8a296, bevel=0.045, jit=0.015, grad=0.35, top=0.1)
    m.add('box', (0.2, 0.04, 0.03), 0x7f7a71, x=-0.06, y=0.05, z=0.19, rz=0.2, grad=0)
    return m.finish('item_stone', c, loc)


def item_shard(c, loc):
    m = Mesh(seed=13)
    crystal(m, 0, 0, 0.42, 0.11, 0, 0.1, 0xff9a3a, base_y=-0.18)
    crystal(m, 0.13, 0, 0.3, 0.08, 0.1, -0.5, 0xffc45a, base_y=-0.18)
    crystal(m, -0.12, 0.04, 0.26, 0.08, -0.2, 0.55, 0xff6a2a, base_y=-0.18)
    return m.finish('item_shard', c, loc)


# ---------------------------------------------------------------- camp & structures
def flame(c, loc):
    m = Mesh(seed=17)
    m.add('cyl', (0.0, 0.34, 1.0, 7), 0xff7a22, y=0.5, glow=True, grad=0.0, top=0, var=0.0, hue=0)
    m.add('cyl', (0.0, 0.22, 0.75, 7), 0xffc243, y=0.38, x=0.04, ry=0.4, glow=True, grad=0, top=0, var=0.0, hue=0)
    m.add('cyl', (0.0, 0.12, 0.45, 6), 0xfff1b8, y=0.25, glow=True, grad=0, top=0, var=0.0, hue=0)
    return m.finish('flame', c, loc)


def hearth(c, loc):
    m = Mesh(seed=19)
    m.add('cyl', (0.78, 0.86, 0.1, 14), 0x3a2f2a, y=0.05, grad=0, jit=0.02)
    for i in range(11):
        a = i / 11 * TAU
        m.add('ico', (0.22, 1), [STONE, STONE_L, STONE_D][i % 3], x=math.cos(a) * 0.86, y=0.13, z=math.sin(a) * 0.86, sx=1.25,
              sy=0.75, ry=-a, jit=0.05, moss=MOSS if i % 4 == 0 else None)
    for i in range(4):
        a = i / 4 * TAU + 0.3
        m.add('cyl', (0.06, 0.08, 1.05, 6), [0x7a4a2a, 0x5a3720][i % 2], x=math.cos(a) * 0.22, y=0.38, z=math.sin(a) * 0.22,
              rz=-math.cos(a) * 0.45, rx=math.sin(a) * 0.45, cap=0x2a1d16, grad=0.6)
    for i in range(7):
        a = i * 0.9
        m.add('ico', (0.05, 0), 0xff7a2a, x=math.cos(a) * 0.32, y=0.11, z=math.sin(a) * 0.3, glow=True)
    return m.finish('hearth', c, loc)


def hearth_ring(c, loc):
    """Flagstone court that appears at hearth level 2."""
    m = Mesh(seed=29)
    for ring, (r, n) in enumerate([(1.55, 13), (2.3, 19)]):
        for i in range(n):
            a = (i + ring * 0.5) / n * TAU
            m.add('box', (0.62 + ring * 0.08, 0.08, 0.42), [0xa29b8d, 0x8f897d, 0xb1aa9b][(i + ring) % 3], x=math.cos(a) * r, y=0.04,
                  z=math.sin(a) * r, ry=-a, bevel=0.03, jit=0.015, grad=0.0, top=0.05)
    for a in (0.6, 2.7, 4.6):
        m.add('cyl', (0.17, 0.17, 1.3, 8), 0x7a4a2a, x=math.cos(a) * 3.1, y=0.22, z=math.sin(a) * 3.1, rx=math.pi / 2, ry=-a,
              cap=CUT, bevel=0.02)
        for s in (-0.45, 0.45):
            m.add('box', (0.12, 0.2, 0.3), 0x5a3720, x=math.cos(a) * 3.1 + math.sin(a) * s, y=0.08,
                  z=math.sin(a) * 3.1 - math.cos(a) * s, ry=-a)
    return m.finish('hearth_ring', c, loc)


def monolith(c, loc):
    m = Mesh(seed=31)
    m.add('box', (0.42, 1.6, 0.32), 0xb2ab9c, y=0.8, bevel=0.05, jit=0.04, grad=0.45, moss=MOSS, top=0.12)
    m.add('box', (0.5, 0.16, 0.4), 0x9a9486, y=0.08, bevel=0.03, jit=0.02)
    for y, w in ((1.1, 0.16), (0.82, 0.08), (0.6, 0.12)):
        m.add('box', (w, 0.05, 0.03), 0xffb04a, y=y, z=0.165, glow=True, grad=0, top=0)
    m.add('box', (0.05, 0.36, 0.03), 0xffb04a, y=0.86, z=0.165, glow=True, grad=0, top=0)
    return m.finish('monolith', c, loc)


def lantern(c, loc):
    m = Mesh(seed=43)
    m.add('cyl', (0.07, 0.1, 2.05, 7), 0x7a4a2a, y=1.02, bevel=0.01, grad=0.4)
    for i in range(5):
        a = i / 5 * TAU
        m.add('ico', (0.13, 1), [STONE, STONE_L][i % 2], x=math.cos(a) * 0.2, y=0.06, z=math.sin(a) * 0.2, sy=0.6, jit=0.03)
    m.add('box', (0.78, 0.08, 0.09), 0x7a4a2a, x=0.3, y=1.9, bevel=0.015)
    m.add('box', (0.06, 0.4, 0.06), 0x6a3f22, x=0.18, y=1.72, rz=0.75)
    m.add('box', (0.02, 0.18, 0.02), IRON_D, x=0.55, y=1.78, grad=0)
    lx, ly = 0.55, 1.42
    m.add('cyl', (0.0, 0.2, 0.16, 4), IRON_D, x=lx, y=ly + 0.25, ry=math.pi / 4, grad=0)
    m.add('box', (0.28, 0.04, 0.28), IRON_D, x=lx, y=ly - 0.17, grad=0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.add('box', (0.03, 0.34, 0.03), IRON, x=lx + sx * 0.12, y=ly, z=sz * 0.12, grad=0)
    m.add('box', (0.2, 0.3, 0.2), 0xffd27a, x=lx, y=ly, glow=True, grad=0, top=0, var=0)
    return m.finish('lantern', c, loc)


def wall(c, loc):
    """Palisade segment, 2 m along x, sharpened logs."""
    m = Mesh(seed=47)
    hs = [1.55, 1.75, 1.62, 1.8, 1.58, 1.7]
    for i, h in enumerate(hs):
        x = -0.85 + i * 0.34
        m.add('cyl', (0.13, 0.15, h, 8), [0x84532d, 0x74472a, 0x8e5c34][i % 3], x=x, y=h / 2, ry=i, jit=0.015, grad=0.5)
        m.add('cyl', (0.0, 0.13, 0.32, 8), CUT, x=x, y=h + 0.16, ry=i, grad=0.2)
    for y in (0.45, 1.15):
        m.add('cyl', (0.06, 0.06, 2.1, 7), 0x5e3a20, y=y, z=0.16, rz=math.pi / 2, cap=CUT)
        for i in range(6):
            m.add('box', (0.06, 0.1, 0.32), ROPE, x=-0.85 + i * 0.34, y=y, z=0.06, grad=0)
    return m.finish('wall', c, loc)


def tent(c, loc):
    L, W, H = 2.5, 2.1, 1.65
    ang = math.atan2(H, W / 2)
    side = math.hypot(H, W / 2)
    m = Mesh(seed=59)
    # each panel is a flat slab rotated about z so it runs from the ridge down to the ground
    for s in (-1, 1):
        m.add('box', (side, 0.05, L), CANVAS, x=s * W / 4, y=H / 2, rz=-s * ang, grad=0.3, top=0.1, var=0.03)
        m.add('box', (side, 0.055, 0.22), 0xb5492e, x=s * W / 4, y=H / 2, z=L / 2 - 0.2, rz=-s * ang, grad=0.2)
        for z in (-L / 2 + 0.05, L / 2 - 0.05):
            m.add('cyl', (0.035, 0.035, side * 1.05, 6), 0x6a3f22, x=s * W / 4 * 1.05, y=H / 2, z=z, rz=s * (math.pi / 2 - ang))
    m.add('cyl', (0.045, 0.045, L + 0.4, 6), 0x6a3f22, y=H + 0.02, rx=math.pi / 2, cap=CUT)
    m.tri([(0, H - 0.05, L / 2 + 0.01), (-0.55, 0, L / 2 + 0.01), (0.55, 0, L / 2 + 0.01)], [0x2a1e18, 0x1c1410, 0x1c1410])
    m.tri([(0, H - 0.05, L / 2 + 0.012), (0.55, 0, L / 2 + 0.012), (-0.55, 0, L / 2 + 0.012)], [0x2a1e18, 0x1c1410, 0x1c1410])
    m.add('box', (0.6, 0.12, 1.3), 0x4f6a8c, x=0.15, y=0.06, z=0.1, bevel=0.03)
    m.add('cyl', (0.12, 0.12, 0.6, 8), 0x8a4a3a, x=0.15, y=0.14, z=0.75, rz=math.pi / 2, bevel=0.02)
    for s in (-1, 1):
        for z in (-0.8, 0.8):
            m.add('cyl', (0.01, 0.01, 1.5, 4), ROPE, x=s * 1.55, y=0.62, z=z, rz=s * 0.95, grad=0)
            m.add('cyl', (0.02, 0.03, 0.25, 5), WOOD, x=s * 2.05, y=0.08, z=z, rz=-s * 0.3)
    return m.finish('tent', c, loc)


def flagpole(c, loc):
    m = Mesh(seed=67)
    m.add('cyl', (0.045, 0.065, 3.4, 7), 0x6a3f22, y=1.7, grad=0.4)
    m.add('ico', (0.09, 1), 0xe0b85a, y=3.45)
    for i in range(4):
        a = i / 4 * TAU
        m.add('ico', (0.14, 1), STONE, x=math.cos(a) * 0.18, y=0.06, z=math.sin(a) * 0.18, sy=0.6, jit=0.03)
    pole = m.finish('flagpole', c, loc)
    # banner: a dense strip so the game can wave it; _SWAY = distance from the pole
    f = Mesh(seed=71)
    nx, ny, w, h = 12, 6, 1.3, 0.8
    for i in range(nx):
        for j in range(ny):
            x0, x1, y0, y1 = i / nx * w, (i + 1) / nx * w, -j / ny * h, -(j + 1) / ny * h
            emblem = 0.38 < (i + 0.5) / nx < 0.62 and 0.25 < (j + 0.5) / ny < 0.75
            col = 0xf0c25a if emblem else (0xb83f2a if (j % 3) else 0xa33626)
            s0, s1 = x0 / w, x1 / w
            f.tri([(x0, y0, 0), (x0, y1, 0), (x1, y1, 0)], [col] * 3, sway=[s0, s0, s1])
            f.tri([(x0, y0, 0), (x1, y1, 0), (x1, y0, 0)], [col] * 3, sway=[s0, s1, s1])
    f.finish('flag_cloth', c, (loc[0] + 0.06, 3.3, loc[2]))
    return pole


def woodrack(c, loc):
    m = Mesh(seed=73)
    for z in (-0.42, 0.42):
        m.add('box', (1.9, 0.1, 0.12), 0x5e3a20, y=0.05, z=z, bevel=0.015)
    for x in (-0.95, 0.95):
        for z in (-0.42, 0.42):
            m.add('cyl', (0.05, 0.06, 1.25, 6), 0x6a3f22, x=x, y=0.62, z=z)
            m.add('cyl', (0.0, 0.05, 0.12, 6), CUT, x=x, y=1.3, z=z)
    for x in (-0.95, 0.95):
        m.add('box', (0.06, 0.06, 0.92), ROPE, x=x, y=1.05, grad=0)
    return m.finish('woodrack', c, loc)


def stonebin(c, loc):
    m = Mesh(seed=79)
    m.add('box', (1.5, 0.12, 1.1), 0x6a4a30, y=0.06, bevel=0.02)
    for x in (-0.72, 0.72):
        m.add('box', (0.08, 0.3, 1.12), 0x7a5232, x=x, y=0.2, bevel=0.015)
    m.add('box', (1.5, 0.3, 0.08), 0x7a5232, y=0.2, z=-0.52, bevel=0.015)
    return m.finish('stonebin', c, loc)


def beacon(c, loc):
    """Ruined watchtower on the peak; masonry built course by course."""
    m = Mesh(seed=83)
    m.add('cyl', (1.85, 2.05, 0.4, 10), 0x8a8478, y=0.2, jit=0.04, grad=0.3, moss=MOSS)
    rows, per = 9, 10
    for row in range(rows):
        r = 1.2 - row * 0.035
        for i in range(per):
            if row >= 6 and (i * 7 + row * 3) % 10 < 3:
                continue  # broken crown
            a = (i + (row % 2) * 0.5) / per * TAU
            col = [0xb7b0a0, 0xa49d8e, 0xc2bba9, 0x9b9485][(i + row * 3) % 4]
            m.add('box', (0.74 * r, 0.36, 0.42), col, x=math.cos(a) * r, y=0.58 + row * 0.38, z=math.sin(a) * r, ry=-a + math.pi / 2,
                  bevel=0.035, jit=0.015, grad=0.0, top=0.1, moss=MOSS if row < 3 else None)
    m.add('cyl', (1.0, 1.0, 3.3, 10), 0x3a332d, y=2.1, grad=0)
    # iron brazier on top
    m.add('cyl', (1.0, 0.55, 0.45, 12), IRON_D, y=4.15, grad=0.4)
    m.add('cyl', (1.02, 1.02, 0.06, 12), IRON, y=4.38, grad=0)
    for i in range(6):
        a = i / 6 * TAU
        m.add('cyl', (0.02, 0.04, 0.55, 5), IRON, x=math.cos(a) * 0.98, y=4.62, z=math.sin(a) * 0.98, grad=0)
    m.add('cyl', (0.06, 0.08, 1.2, 6), IRON_D, y=3.55, grad=0)
    # rubble at the foot
    for i in range(9):
        a = i * 0.83
        r = 2.1 + (i % 3) * 0.25
        m.add('box', (0.4, 0.25, 0.3), [0xb7b0a0, 0xa49d8e][i % 2], x=math.cos(a) * r, y=0.12, z=math.sin(a) * r, ry=a * 1.7, rz=0.2,
              bevel=0.03, jit=0.02, moss=MOSS)
    return m.finish('beacon', c, loc)


# ---------------------------------------------------------------- characters
SKIN, TUNIC, TUNIC_D, TROUS, BOOT, BELT, GOLD = 0xeab08a, 0xc4553a, 0x9a3c28, 0x4a5a7c, 0x4d311f, 0x5e3a20, 0xe8b850
HAIR, BEARD, CAP = 0x6a3818, 0x8a4a22, 0x2f7896


def builder(c, loc):
    root = empty('builder', c, loc)
    for side, name in ((1, 'b_legL'), (-1, 'b_legR')):
        m = Mesh(seed=101)
        m.add('box', (0.24, 0.32, 0.26), TROUS, y=-0.15, bevel=0.03, grad=0.3)
        m.add('box', (0.28, 0.07, 0.3), 0x6a4428, y=-0.33, bevel=0.02)
        m.add('box', (0.27, 0.2, 0.36), BOOT, y=-0.46, z=0.04, bevel=0.04, grad=0.2)
        m.add('box', (0.29, 0.05, 0.4), 0x2a1a10, y=-0.575, z=0.045, bevel=0.015, grad=0)
        m.finish(name, c, (0.16 * side, 0.6, 0), root)
    t = Mesh(seed=103)
    t.add('box', (0.6, 0.46, 0.4), TUNIC, y=0.3, bevel=0.07, grad=0.3, top=0.1)
    t.add('box', (0.64, 0.16, 0.43), TUNIC_D, y=0.06, bevel=0.04)
    t.add('box', (0.4, 0.08, 0.36), TUNIC_D, y=0.55, bevel=0.03)
    t.add('box', (0.14, 0.24, 0.03), 0xe9d8b4, y=0.42, z=0.2, grad=0)
    t.add('box', (0.67, 0.09, 0.45), BELT, y=0.13, bevel=0.015)
    t.add('box', (0.13, 0.11, 0.04), GOLD, y=0.13, z=0.235, bevel=0.01, grad=0)
    t.add('box', (0.15, 0.16, 0.1), 0x7a4a2a, x=0.26, y=0.04, z=0.18, bevel=0.025)
    t.add('box', (0.12, 0.13, 0.1), 0x6a3f22, x=-0.3, y=0.03, z=0.1, bevel=0.025)
    t.add('cyl', (0.025, 0.025, 0.36, 6), WOOD, x=-0.3, y=0.04, z=0.2, rz=0.15)
    t.add('box', (0.08, 0.08, 0.16), IRON, x=-0.33, y=0.2, z=0.2, bevel=0.01)
    for s in (1, -1):
        t.add('box', (0.07, 0.56, 0.04), ROPE, x=s * 0.19, y=0.33, z=0.215, rz=-s * 0.12, grad=0)
    # A-frame pack where the haul is lashed
    for s in (1, -1):
        t.add('cyl', (0.035, 0.04, 1.05, 6), 0x7a4a2a, x=s * 0.26, y=0.4, z=-0.28)
    t.add('cyl', (0.03, 0.03, 0.6, 6), 0x7a4a2a, y=0.82, z=-0.28, rz=math.pi / 2)
    t.add('box', (0.64, 0.06, 0.36), 0x7a4a2a, y=-0.05, z=-0.42, bevel=0.015)
    torso = t.finish('b_torso', c, (0, 0.6, 0), root)
    h = Mesh(seed=107)
    h.add('ico', (0.27, 2), SKIN, y=0.27, sx=1.0, sy=0.98, sz=0.95, smooth=True, grad=0.15, var=0.0, hue=0.0)
    h.add('ico', (0.065, 1), 0xd98f6a, y=0.25, z=0.27, smooth=True, var=0, hue=0)
    for s in (1, -1):
        h.add('ico', (0.06, 1), SKIN, x=s * 0.27, y=0.26, sz=0.7, smooth=True, var=0, hue=0)
        h.add('box', (0.055, 0.075, 0.03), 0x1d1410, x=s * 0.1, y=0.31, z=0.245, grad=0, var=0, hue=0)
        h.add('box', (0.11, 0.035, 0.04), HAIR, x=s * 0.1, y=0.37, z=0.245, rz=s * 0.12, grad=0)
        h.add('ico', (0.05, 1), 0xf0a07c, x=s * 0.16, y=0.22, z=0.2, sz=0.5, smooth=True, var=0, hue=0)
    h.add('ico', (0.2, 1), BEARD, y=0.09, z=0.12, sx=1.15, sy=0.72, sz=0.9, jit=0.02, grad=0.3)
    h.add('box', (0.22, 0.05, 0.06), BEARD, y=0.19, z=0.26, bevel=0.018, grad=0)
    h.add('ico', (0.285, 2), CAP, y=0.47, sy=0.55, jit=0.01, smooth=True, grad=0.2)
    h.add('cyl', (0.285, 0.295, 0.08, 14), 0x245f78, y=0.45, bevel=0.02)
    h.add('ico', (0.07, 1), 0xe9d8b4, y=0.64, z=-0.02, jit=0.02)
    h.add('box', (0.44, 0.16, 0.12), HAIR, y=0.3, z=-0.2, bevel=0.04)
    h.finish('b_head', c, (0, 0.56, 0), torso)
    for side, name in ((1, 'b_armL'), (-1, 'b_armR')):
        a = Mesh(seed=109)
        a.add('ico', (0.13, 1), TUNIC, y=0.0, sy=0.9, smooth=False)
        a.add('box', (0.19, 0.26, 0.21), TUNIC, y=-0.13, bevel=0.04)
        a.add('box', (0.15, 0.14, 0.17), SKIN, y=-0.3, bevel=0.03, var=0, hue=0)
        a.add('box', (0.18, 0.06, 0.2), 0x7a4a2a, y=-0.24, bevel=0.015)
        a.add('box', (0.17, 0.13, 0.19), 0x8a5a32, y=-0.42, bevel=0.035)
        arm = a.finish(name, c, (0.4 * side, 0.46, 0), torso)
        if side < 0:
            ax = Mesh(seed=113)
            ax.add('cyl', (0.032, 0.038, 0.74, 7), WOOD_L, z=0.2, rx=math.pi / 2, grad=0)
            ax.add('box', (0.06, 0.16, 0.12), IRON, y=-0.03, z=0.52, bevel=0.012)
            ax.add('box', (0.035, 0.1, 0.18), 0xdfe4e8, y=-0.15, z=0.52, rx=0.0, bevel=0.01, grad=0)
            ax.add('box', (0.07, 0.05, 0.08), 0x3a2a1a, z=-0.12, grad=0)
            ax.finish('b_axe', c, (0, -0.42, 0.02), arm)
            pk = Mesh(seed=127)
            pk.add('cyl', (0.032, 0.038, 0.74, 7), WOOD_L, z=0.2, rx=math.pi / 2, grad=0)
            pk.add('box', (0.08, 0.09, 0.1), IRON_D, z=0.55, bevel=0.015)
            pk.add('cyl', (0.0, 0.05, 0.32, 5), IRON, y=-0.2, z=0.55, rx=math.pi, grad=0)
            pk.add('cyl', (0.0, 0.05, 0.26, 5), IRON, y=0.17, z=0.55, grad=0)
            pk.finish('b_pick', c, (0, -0.42, 0.02), arm)
    return root


def wolf(c, loc):
    root = empty('wolf', c, loc)
    SH, SH_D, SH_L = 0x2a1e3c, 0x1b1328, 0x45325e
    b = Mesh(seed=131, base='Shade')
    b.add('ico', (0.42, 2), SH, z=-0.05, sx=0.85, sy=0.75, sz=1.45, jit=0.05, grad=0.5, top=0.15)
    b.add('ico', (0.36, 1), SH_L, y=0.12, z=0.32, sx=1.05, sy=1.0, sz=0.9, jit=0.07, grad=0.4)
    for i in range(5):
        b.add('cyl', (0.0, 0.08, 0.36, 4), SH_D, x=(i % 2 - 0.5) * 0.12, y=0.38 - i * 0.03, z=0.25 - i * 0.16, rx=-0.9, grad=0.3)
    b.add('ico', (0.22, 1), SH, y=0.32, z=0.62, sx=1.0, sy=0.9, sz=1.15, jit=0.03)
    b.add('box', (0.16, 0.13, 0.3), SH_D, y=0.25, z=0.84, bevel=0.03)
    b.add('ico', (0.04, 1), 0x0e0a14, y=0.29, z=0.99)
    for s in (1, -1):
        b.add('cyl', (0.0, 0.07, 0.22, 4), SH_D, x=s * 0.12, y=0.53, z=0.56, rz=-s * 0.25, rx=-0.15)
        b.add('box', (0.07, 0.035, 0.04), 0xffe07a, x=s * 0.09, y=0.36, z=0.8, rz=s * 0.25, glow=True, grad=0, top=0, var=0)
        b.add('cyl', (0.0, 0.025, 0.09, 4), 0xeee6d8, x=s * 0.05, y=0.17, z=0.93, rx=math.pi, grad=0)
    body = b.finish('w_body', c, (0, 0.62, 0), root)
    for name, x, z in (('w_legFL', 0.17, 0.32), ('w_legFR', -0.17, 0.32), ('w_legBL', 0.17, -0.4), ('w_legBR', -0.17, -0.4)):
        l = Mesh(seed=137, base='Shade')
        l.add('box', (0.13, 0.36, 0.16), SH, y=-0.17, bevel=0.03, grad=0.4)
        l.add('box', (0.1, 0.28, 0.12), SH_D, y=-0.42, z=0.02, bevel=0.025)
        l.add('box', (0.12, 0.05, 0.16), SH_D, y=-0.555, z=0.04, bevel=0.015)
        l.finish(name, c, (x, 0.58, z), root)
    tl = Mesh(seed=139, base='Shade')
    for i, (r, z, y) in enumerate(((0.12, -0.1, 0.05), (0.1, -0.28, 0.12), (0.08, -0.44, 0.22), (0.05, -0.56, 0.3))):
        tl.add('ico', (r, 1), [SH_L, SH, SH_D, 0x7a4ad0][i], y=y, z=z, sz=1.4, jit=0.02, glow=i == 3, sway=(0.0, 0.3, 1.0))
    tl.finish('w_tail', c, (0, 0.78, -0.6), root)
    return root


ALL = [tree_pine, tree_oak, tree_birch, stump, rock_a, rock_b, rubble, ember, item_log, item_stone, item_shard, flame, hearth,
       hearth_ring, monolith, lantern, wall, tent, flagpole, woodrack, stonebin, beacon, builder, wolf]


def build_kit(c, z0=70.0):
    out = []
    for i, fn in enumerate(ALL):
        out.append(fn(c, ((i % 8) * 4.5 - 16, 0, z0 + (i // 8) * 5)))
    return out
