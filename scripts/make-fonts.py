# Builds src/fonts/*.ttf from Bitstream's Courier 10 Pitch Type 1 fonts (the free Courier that
# Final Draft's Courier is drawn from), so the screen and the PDF use one set of outlines.
#   python3 -I scripts/make-fonts.py <dir with c0419bt_.pfb c0582bt_.pfb c0583bt_.pfb c0611bt_.pfb> src/fonts
# Every glyph is 600/1000 em wide. Line metrics put the baseline 0.71 em down a 1 em line,
# where Final Draft prints it.
import sys, os
from fontTools.t1Lib import T1Font
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.agl import toUnicode
from fontTools.pens.recordingPen import DecomposingRecordingPen

NOTICE = ("(c) Copyright 1989-1992, Bitstream Inc., Cambridge, MA. You are hereby granted permission "
          "under all Bitstream propriety rights to use, copy, modify, sublicense, sell, and redistribute "
          "the 4 Bitstream Charter (r) Type 1 outline fonts and the 4 Courier Type 1 outline fonts for "
          "any purpose and without restriction; provided, that this notice is left intact on all copies "
          "of such fonts and that Bitstream's trademark is acknowledged as shown below on all unmodified "
          "copies of the 4 Charter Type 1 fonts. BITSTREAM CHARTER is a registered trademark of Bitstream Inc.")
FACES = [('c0419bt_.pfb', 'Regular', 400), ('c0583bt_.pfb', 'Bold', 700),
         ('c0582bt_.pfb', 'Italic', 400), ('c0611bt_.pfb', 'Bold Italic', 700)]
FAMILY = 'STET Courier'
ASC, DESC = 710, 290

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for fn, style, weight in FACES:
    t1 = T1Font(os.path.join(src, fn)); t1.parse()
    cs = t1.font['CharStrings']
    names = ['.notdef'] + sorted(n for n in cs.keys() if n != '.notdef')
    glyphs, metrics, cmap = {}, {}, {}
    for n in names:
        pen = TTGlyphPen(None)
        rec = DecomposingRecordingPen(cs)  # accented letters are built from two glyphs
        cs[n].draw(rec)
        rec.replay(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyphs[n] = pen.glyph()
        metrics[n] = (600, 0)
        u = toUnicode(n)
        if len(u) == 1 and n != '.notdef': cmap[ord(u)] = n
    if 0x2d in cmap: cmap.setdefault(0xad, cmap[0x2d])
    if 0x20 in cmap: cmap.setdefault(0xa0, cmap[0x20])
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    for n in names:
        g = fb.font['glyf'][n]; g.recalcBounds(fb.font['glyf'])
        metrics[n] = (600, getattr(g, 'xMin', 0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC, descent=-DESC, lineGap=0)
    ps = 'STETCourier-' + style.replace(' ', '')
    fb.setupNameTable({'familyName': FAMILY, 'styleName': style, 'uniqueFontIdentifier': ps,
                       'fullName': f'{FAMILY} {style}', 'psName': ps, 'version': 'Version 1.0',
                       'copyright': NOTICE, 'description': 'Courier 10 Pitch by Bitstream, converted to TrueType for STET.'})
    sel = (1 if 'Italic' in style else 0) | (0x20 if weight == 700 else 0) | (0x40 if style == 'Regular' else 0) | 0x80
    fb.setupOS2(sTypoAscender=ASC, sTypoDescender=-DESC, sTypoLineGap=0, usWinAscent=ASC, usWinDescent=DESC,
                usWeightClass=weight, fsSelection=sel, xAvgCharWidth=600, achVendID='STET',
                version=4, ulCodePageRange1=1, fsType=0)
    fb.setupPost(isFixedPitch=1, keepGlyphNames=True, italicAngle=-12 if 'Italic' in style else 0)
    fb.setupHead(unitsPerEm=1000, created=3870000000, modified=3870000000, macStyle=(1 if weight == 700 else 0) | (2 if 'Italic' in style else 0))
    fb.save(os.path.join(out, ps + '.ttf'))
    print(ps, len(names), 'glyphs')
with open(os.path.join(out, 'LICENSE.txt'), 'w') as f:
    f.write('STET Courier is Bitstream\'s Courier 10 Pitch, converted to TrueType (scripts/make-fonts.py).\n\n' + NOTICE + '\n')
