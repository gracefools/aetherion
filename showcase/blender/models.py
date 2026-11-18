# Step 2 of the 2.5D prototype: low-poly 3D models built in Blender from Python, rendered headless
# (Cycles on the CPU) from the game's camera angle in 8 directions, as transparent sprite frames.
#   blender -b -P showcase/blender/models.py -- <out_dir>
# Each model is a set of simple shapes with flat materials, so the small renders read as pixel art.
import bpy, math, sys, os
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/app/.run/blender/out'
os.makedirs(OUT, exist_ok=True)
ELEV = math.radians(40)  # the 2.5D camera looks down at about 40 degrees


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.filter_size = 0.01  # no anti-aliasing: hard pixel edges
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.85, 0.78, 0.7, 1); bg.inputs[1].default_value = 0.55
    return sc


_mats = {}
def mat(name, rgb, emit=0.0, rough=0.8, metal=0.0):
    key = (name, rgb, emit)
    if key in _mats: return _mats[key]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    col = tuple(int(rgb[i:i + 2], 16) / 255 for i in (1, 3, 5))
    col = tuple(c ** 2.2 for c in col) + (1,)
    b.inputs['Base Color'].default_value = col
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission'].default_value = col
        b.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


def part(kind, loc, scale, m, rot=(0, 0, 0), parent=None, **kw):
    ops = {'cube': bpy.ops.mesh.primitive_cube_add, 'sphere': bpy.ops.mesh.primitive_uv_sphere_add,
           'cyl': bpy.ops.mesh.primitive_cylinder_add, 'cone': bpy.ops.mesh.primitive_cone_add,
           'ico': bpy.ops.mesh.primitive_ico_sphere_add}
    if kind == 'sphere': kw.setdefault('segments', 14); kw.setdefault('ring_count', 9)
    if kind in ('cyl', 'cone'): kw.setdefault('vertices', 10)
    if kind == 'ico': kw.setdefault('subdivisions', 1)
    ops[kind](location=loc, rotation=[math.radians(a) for a in rot], **kw)
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(m)
    if kind in ('sphere', 'cyl', 'cone'): bpy.ops.object.shade_smooth()
    if parent: o.parent = parent
    return o


def root(name):
    bpy.ops.object.empty_add(location=(0, 0, 0)); e = bpy.context.active_object; e.name = name
    return e


# --------------------------------------------------------------------------------------------
# Models. +Y is the facing direction, +Z is up, 1 unit = 1 game tile.
# --------------------------------------------------------------------------------------------
def shared_mats():  # created again after every reset (a factory reset removes all materials)
    global STEEL, STEEL_D, GOLD, BLUE, RED, LEATHER
    _mats.clear()
    STEEL, STEEL_D, GOLD = mat('steel', '#c8ccd8', rough=0.35, metal=0.8), mat('steel_d', '#6a7088', rough=0.4, metal=0.7), mat('gold', '#e8b84a', rough=0.3, metal=0.9)
    BLUE, RED, LEATHER = mat('blue', '#2a4a9a'), mat('red', '#b8303a'), mat('leather', '#5a3a24')


def knight(r, z0=0.0, riding=False):
    """A paladin in plate: crested helm, blue tabard, cape, kite shield and sword."""
    if riding:  # legs astride
        for s in (-1, 1):
            part('cyl', (0.17 * s, 0.08, z0 + 0.22), (0.075, 0.075, 0.2), STEEL, rot=(60, 0, 18 * s), parent=r)
            part('cyl', (0.26 * s, 0.22, z0 - 0.02), (0.07, 0.07, 0.17), STEEL_D, rot=(-10, 0, 0), parent=r)
    else:
        for s in (-1, 1):
            part('cyl', (0.1 * s, 0, z0 + 0.22), (0.075, 0.075, 0.22), STEEL, parent=r)
            part('cube', (0.1 * s, 0.04, z0 + 0.03), (0.08, 0.12, 0.04), STEEL_D, parent=r)
    zt = z0 + (0.42 if riding else 0.44)
    part('cube', (0, 0, zt + 0.08), (0.2, 0.13, 0.08), STEEL_D, parent=r)  # belt and hips
    part('cyl', (0, 0, zt + 0.3), (0.22, 0.15, 0.2), STEEL, parent=r)  # chest
    part('cube', (0, 0.12, zt + 0.18), (0.13, 0.04, 0.24), BLUE, parent=r)  # tabard
    part('cube', (0, 0.165, zt + 0.3), (0.05, 0.01, 0.07), GOLD, parent=r)  # emblem
    for s in (-1, 1):
        part('sphere', (0.25 * s, 0, zt + 0.44), (0.11, 0.11, 0.09), STEEL, parent=r)  # pauldrons
        part('cyl', (0.27 * s, 0.03, zt + 0.25), (0.06, 0.06, 0.15), STEEL, parent=r)  # arms
    part('cube', (0, -0.15, zt + 0.12), (0.2, 0.02, 0.34), RED, rot=(-8, 0, 0), parent=r)  # cape
    part('sphere', (0, 0.01, zt + 0.62), (0.15, 0.15, 0.16), STEEL, parent=r)  # helm
    part('cube', (0, 0.14, zt + 0.61), (0.09, 0.02, 0.025), mat('visor', '#141420'), parent=r)  # visor slit
    part('cube', (0, -0.02, zt + 0.8), (0.025, 0.14, 0.06), RED, parent=r)  # crest
    sh = part('cube', (-0.4, 0.1, zt + 0.22), (0.02, 0.15, 0.2), BLUE, parent=r)  # kite shield
    part('cube', (-0.37, 0.1, zt + 0.22), (0.02, 0.17, 0.22), GOLD, parent=r)
    part('cube', (-0.425, 0.1, zt + 0.24), (0.01, 0.03, 0.09), GOLD, parent=r)
    part('cube', (0.34, 0.12, zt + 0.42 if riding else zt + 0.1), (0.02, 0.02, 0.3), STEEL, parent=r, rot=(20 if riding else -10, 0, 0))  # sword
    part('cube', (0.34, 0.08, zt + 0.15 if riding else zt + 0.33), (0.08, 0.02, 0.02), GOLD, parent=r)
    return r


def horse(r):
    """A barded warhorse: body, arched neck, long head, four legs with feathered hooves, blue caparison."""
    COAT, MANE, HOOF = mat('coat', '#6a3a22'), mat('mane', '#2a1810'), mat('hoof', '#d8ccb8')
    part('sphere', (0, 0, 0.95), (0.3, 0.62, 0.3), COAT, parent=r)
    part('cyl', (0, 0.52, 1.25), (0.15, 0.15, 0.3), COAT, rot=(-35, 0, 0), parent=r)
    part('cube', (0, 0.78, 1.42), (0.11, 0.25, 0.12), COAT, rot=(28, 0, 0), parent=r)  # head
    part('cube', (0, 0.42, 1.38), (0.04, 0.2, 0.18), MANE, rot=(-35, 0, 0), parent=r)  # mane
    for s in (-1, 1):
        part('cone', (0.07 * s, 0.66, 1.62), (0.04, 0.04, 0.08), COAT, parent=r)  # ears
        part('sphere', (0.1 * s, 0.86, 1.47), (0.025, 0.025, 0.025), mat('eye', '#101010'), parent=r)
        for y in (0.38, -0.38):
            part('cyl', (0.17 * s, y, 0.4), (0.07, 0.07, 0.38), COAT, parent=r)
            part('cyl', (0.17 * s, y, 0.06), (0.095, 0.095, 0.07), HOOF, parent=r)
    part('cone', (0, -0.72, 0.95), (0.1, 0.1, 0.45), MANE, rot=(-130, 0, 0), parent=r)  # tail
    # caparison: a blue cloth with a gold hem, the saddle, a chanfron on the head
    part('cyl', (0, 0, 0.92), (0.33, 0.55, 0.26), BLUE, parent=r)
    part('cyl', (0, 0, 0.67), (0.335, 0.555, 0.03), GOLD, parent=r)
    part('cube', (0, 0.02, 1.27), (0.2, 0.2, 0.05), LEATHER, parent=r)
    part('cube', (0, 0.84, 1.5), (0.1, 0.18, 0.04), STEEL, rot=(28, 0, 0), parent=r)
    knight(root('rider'), z0=1.0, riding=True).parent = r
    return r


def fox(r):
    """The mythic ember fox: orange coat, white chest, black socks, a big tail with a burning tip."""
    FUR, WHITE, BLACK = mat('fur', '#e8682a'), mat('white', '#f4ead8'), mat('black', '#2a1a14')
    FLAME = mat('flame', '#ffb43a', emit=6)
    part('sphere', (0, 0, 0.32), (0.16, 0.3, 0.15), FUR, parent=r)
    part('sphere', (0, 0.18, 0.3), (0.11, 0.1, 0.12), WHITE, parent=r)
    part('sphere', (0, 0.32, 0.5), (0.14, 0.13, 0.12), FUR, parent=r)  # head
    part('cone', (0, 0.48, 0.47), (0.06, 0.06, 0.12), WHITE, rot=(-90, 0, 0), parent=r)  # snout
    part('sphere', (0, 0.6, 0.48), (0.025, 0.025, 0.025), BLACK, parent=r)
    for s in (-1, 1):
        part('cone', (0.08 * s, 0.3, 0.66), (0.05, 0.035, 0.09), FUR, parent=r)
        part('cone', (0.08 * s, 0.31, 0.75), (0.02, 0.015, 0.03), BLACK, parent=r)
        part('sphere', (0.06 * s, 0.43, 0.54), (0.018, 0.018, 0.018), BLACK, parent=r)
        for y in (0.18, -0.16):
            part('cyl', (0.08 * s, y, 0.12), (0.035, 0.035, 0.12), BLACK, parent=r)
    part('sphere', (0, -0.42, 0.5), (0.13, 0.26, 0.13), FUR, rot=(-45, 0, 0), parent=r)  # tail
    part('sphere', (0, -0.58, 0.68), (0.09, 0.12, 0.09), WHITE, rot=(-45, 0, 0), parent=r)
    part('ico', (0, -0.64, 0.78), (0.09, 0.09, 0.14), FLAME, parent=r)
    lt = bpy.data.lights.new('ember', 'POINT'); lt.energy = 6; lt.color = (1, 0.6, 0.2)
    lo = bpy.data.objects.new('ember', lt); lo.location = (0, -0.64, 0.86); lo.parent = r
    bpy.context.collection.objects.link(lo)
    return r


# --------------------------------------------------------------------------------------------
# Lighting and the camera of the game: orthographic, 40 degrees down; the model turns in steps of 45
# --------------------------------------------------------------------------------------------
def rig(sc, height, px_per_unit):
    k = bpy.data.lights.new('key', 'SUN'); k.energy = 3.2; k.color = (1, 0.85, 0.66); k.angle = math.radians(8)
    ko = bpy.data.objects.new('key', k); ko.rotation_euler = (math.radians(50), 0, math.radians(-120)); bpy.context.collection.objects.link(ko)
    f = bpy.data.lights.new('fill', 'SUN'); f.energy = 0.6; f.color = (0.6, 0.7, 1)
    fo = bpy.data.objects.new('fill', f); fo.rotation_euler = (math.radians(60), 0, math.radians(60)); bpy.context.collection.objects.link(fo)
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam); bpy.context.collection.objects.link(co); sc.camera = co
    d = 10
    co.location = (0, -d * math.cos(ELEV), height * 0.5 + d * math.sin(ELEV))
    co.rotation_euler = (math.pi / 2 - ELEV, 0, 0)
    return cam


def render(name, build, w, h, height, ortho):
    sc = reset()
    shared_mats()
    r = build(root(name))
    cam = rig(sc, height, 0)
    cam.ortho_scale = ortho
    sc.render.resolution_x, sc.render.resolution_y = w, h
    for k in range(8):  # 0 = facing the camera (south), then clockwise in steps of 45 degrees
        r.rotation_euler = (0, 0, math.radians(180 + 45 * k))
        sc.render.filepath = os.path.join(OUT, f'{name}_{k}.png')
        bpy.ops.render.render(write_still=True)
    print('rendered', name)


render('knight', knight, 48, 64, 1.2, 1.9)
render('horse', horse, 112, 112, 2.0, 3.3)
render('fox', fox, 48, 48, 0.8, 1.5)
