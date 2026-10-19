# Heft art pipeline — shared helpers. Everything is authored in GAME space (x right, y up, z toward the camera),
# which is exactly what the Y-up glTF export hands to three.js, so numbers here match the game 1:1.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler, noise

TAU = math.tau
C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game (x, y, z) -> blender (x, -z, y)
C4I = C4.inverted()


def gv(x, y, z):
    """Game-space point -> Blender vector."""
    return Vector((x, -z, y))


def srgb(h):
    return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v


def sstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def to_lin(c):
    return (lin(clamp(c[0])), lin(clamp(c[1])), lin(clamp(c[2])), 1.0)


def fbm(x, z, octaves=4, seed=0.0):
    v, a, f, s = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        v += a * noise.noise(Vector((x * f, z * f, seed + i * 1.7)))
        s += a
        a *= 0.5
        f *= 2.03
    return v / s


# ---------------------------------------------------------------- materials
def material(name, emit=0.0, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        nt.links.new(col.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


MATS = {}


def mats():
    if not MATS:
        MATS['Base'] = material('Base')
        MATS['Glow'] = material('Glow', emit=2.5)
        MATS['Shade'] = material('Shade', rough=0.6)
    return MATS


# ---------------------------------------------------------------- mesh builder
class Mesh:
    """Accumulates coloured primitives into one bmesh. Material slots: 0 base (or shade), 1 glow."""

    def __init__(self, seed=1, base='Base'):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.sway = self.bm.verts.layers.float.new('_SWAY')
        self.rnd = random.Random(seed)
        self.seed = seed
        self.base = base
        self.any_sway = False
        self.any_glow = False

    def add(self, kind, args, color, x=0, y=0, z=0, rx=0, ry=0, rz=0, sx=1, sy=1, sz=1, jit=0.0, var=0.05, grad=0.25,
            top=0.08, bevel=0.0, glow=False, sway=None, smooth=False, cap=None, moss=None, hue=0.03):
        bm = self.bm
        mg = Matrix.LocRotScale(Vector((x, y, z)), Euler((rx, ry, rz), 'ZYX'), Vector((sx, sy, sz)))
        M = C4 @ mg @ C4I
        if kind == 'box':
            w, h, d = args
            res = bmesh.ops.create_cube(bm, size=1.0, matrix=M @ Matrix.Diagonal((w, d, h, 1)))
        elif kind == 'cyl':  # (r_top, r_bottom, height, segments) along game Y, centred
            rt, rb, h, seg = args
            res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=rb, radius2=max(rt, 0.0),
                                        depth=h, matrix=M)
        elif kind == 'ico':  # (radius, subdivisions)
            r, sub = args
            res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=M)
        elif kind == 'sph':  # (radius, u, v)
            r, u, v = args
            res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, matrix=M)
        else:
            raise ValueError(kind)
        verts = [v for v in res['verts'] if v.is_valid]
        # merge the duplicate apex verts cones leave behind
        bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-5)
        verts = [v for v in verts if v.is_valid]
        if jit:
            off = Vector((self.seed * 3.1, self.seed * 1.7, self.seed * 0.9))
            for v in verts:
                v.co += noise.noise_vector(v.co * 2.1 + off) * jit
        faces = {f for v in verts for f in v.link_faces}
        ys = [v.co.z for v in verts]
        y0, y1 = min(ys), max(ys)
        axis = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
        base = srgb(color)
        capc = srgb(cap) if cap is not None else None
        mossc = srgb(moss) if moss is not None else None
        rnd = self.rnd
        for f in faces:
            f.smooth = smooth
            f.material_index = 1 if glow else 0
            n = f.normal
            c = base
            if capc and abs(n.dot(axis)) > 0.9:
                c = capc
            cy = f.calc_center_median()
            if mossc and n.z > 0.45 and noise.noise(cy * 1.7) > -0.25:
                c = mix(c, mossc, clamp((n.z - 0.45) * 2.2))
            t = (cy.z - y0) / (y1 - y0) if y1 > y0 else 1
            k = 1 - grad * (1 - t) + top * n.z + (rnd.random() - 0.5) * 2 * var
            hj = [(rnd.random() - 0.5) * 2 * hue for _ in range(3)]
            lc = to_lin([c[i] * k * (1 + hj[i]) for i in range(3)])
            for lp in f.loops:
                lp[self.col] = lc
        if bevel:  # after colouring, so the chamfer faces inherit the neighbouring colours
            edges = list({e for f in faces for e in f.edges})
            r = bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=1, profile=0.5,
                                affect='EDGES', clamp_overlap=True)
            for f in r['faces']:
                f.smooth = smooth
            faces = {f for f in faces if f.is_valid} | set(r['faces'])
            verts = list({v for f in faces for v in f.verts})
        if glow:
            self.any_glow = True
        if sway is not None:
            self.any_sway = True
            for v in verts:
                if isinstance(sway, tuple):  # (y_from, y_to, amount) ramps with height
                    a, b, amt = sway
                    v[self.sway] = amt * clamp((v.co.z - a) / (b - a)) ** 1.5
                else:
                    v[self.sway] = sway
        return verts

    def tri(self, pts, colors, sway=None, glow=False):
        """Raw polygon in game space; colors per corner (hex ints)."""
        vs = [self.bm.verts.new(gv(*p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = 1 if glow else 0
        for lp, c in zip(f.loops, colors):
            lp[self.col] = to_lin(srgb(c) if isinstance(c, int) else c)
        if sway is not None:
            self.any_sway = True
            for v, s in zip(vs, sway):
                v[self.sway] = s
        return f

    def finish(self, name, collection, loc=(0, 0, 0), parent=None):
        me = bpy.data.meshes.get(name)
        if me:
            bpy.data.meshes.remove(me)
        me = bpy.data.meshes.new(name)
        if not self.any_sway:
            self.bm.verts.layers.float.remove(self.sway)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        M = mats()
        me.materials.append(M[self.base])
        if self.any_glow:
            me.materials.append(M['Glow'])
        ca = me.color_attributes
        ca.active_color = ca['Col']
        ca.render_color_index = ca.active_color_index
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        if parent:
            ob.parent = parent
        ob.location = gv(*loc)
        return ob


def empty(name, collection, loc=(0, 0, 0), parent=None):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    collection.objects.link(e)
    if parent:
        e.parent = parent
    e.location = gv(*loc)
    return e


def coll(name, parent=None, wipe=True):
    c = bpy.data.collections.get(name)
    if c and wipe:
        for o in list(c.all_objects):
            me = o.data if o.type == 'MESH' else None
            bpy.data.objects.remove(o)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
    if not c:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c
