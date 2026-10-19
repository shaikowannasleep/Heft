# Heft art pipeline — one call rebuilds every asset, bakes AO and writes models/heft.glb.
# In Blender:  import sys; sys.path.insert(0, '<repo>/blender'); import build; build.run()
import bpy, os, time, importlib
import core, kit, island

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models', 'heft.glb')


def run(out=OUT, preview=True):
    for m in (core, kit, island):
        importlib.reload(m)
    t = time.time()
    kc = core.coll('HeftKit')
    kit.build_kit(kc, z0=70.0)
    ic = core.coll('HeftIsland')
    F, terrain, spawns, anchors = island.build_island(ic)
    old = bpy.data.objects.get('decor')
    if old:
        bpy.data.objects.remove(old)
    pc = island.preview(F, spawns, anchors) if preview else None
    island.bake_ao([terrain], distance=3.5, strength=0.7, samples=64)
    island.build_decor(ic, F, spawns, ao=island.ao_sampler(terrain))
    for c in (ic, pc):
        if c:
            c.hide_render = True
    island.bake_ao([o for o in kc.all_objects if o.type == 'MESH'], distance=0.5, strength=0.6, samples=32)
    for c in (ic, pc):
        if c:
            c.hide_render = False
    del terrain['ao']
    export(out, list(kc.all_objects) + [terrain, bpy.data.objects['decor']])
    print('heft build %.1fs -> %s (%d KB)' % (time.time() - t, out, os.path.getsize(out) // 1024))


def export(out, objs):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True,
                              export_extras=True, export_texcoords=False, export_materials='EXPORT',
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=8,
                              export_draco_color_quantization=8, export_draco_generic_quantization=8)
