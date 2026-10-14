"""Independent qpdf-backed export structure oracle. No Legir/PDFium imports."""
import json
import sys
import pikepdf


def inspect(path):
    with pikepdf.open(path) as pdf:
        pages = list(pdf.pages)
        indexes = {page.obj.objgen: i for i, page in enumerate(pages)}
        names = dict(pdf.Root.get('/Dests', {}))

        def text(value):
            if isinstance(value, pikepdf.Name):
                return str(value)[1:]
            if isinstance(value, pikepdf.String):
                return str(value)
            return None

        def read_names(node, visited=None):
            if not isinstance(node, pikepdf.Dictionary):
                return
            visited = set() if visited is None else visited
            if node.is_indirect and node.objgen in visited:
                return
            visited.add(node.objgen)
            entries = node.get('/Names', [])
            for i in range(0, len(entries)-1, 2):
                names[text(entries[i])] = entries[i+1]
            for child in node.get('/Kids', []):
                read_names(child, visited)

        read_names(pdf.Root.get('/Names', {}).get('/Dests'))
        names = {str(k).lstrip('/'): v for k, v in names.items()}

        def destination(value, depth=0):
            if value is None or depth > 32:
                return None
            if isinstance(value, pikepdf.Dictionary):
                return destination(value.get('/D'), depth+1)
            if isinstance(value, pikepdf.Array):
                return indexes.get(value[0].objgen) if len(value) and isinstance(value[0], pikepdf.Dictionary) else None
            name = text(value)
            return destination(names.get(name), depth+1) if name is not None else None

        def identity(obj):
            return [text(obj.get('/'+k)) for k in ['Subtype','Contents','T','State','StateModel']] if isinstance(obj, pikepdf.Dictionary) else None

        out_pages = []
        for page in pages:
            annotations, links, replies = {}, [], []
            annots = page.obj.get('/Annots', [])
            refs = {v.objgen for v in annots if v.is_indirect}
            for item in annots:
                name = text(item.get('/Subtype')) or 'unknown'
                annotations[name] = annotations.get(name, 0) + 1
                parent, popup = item.get('/IRT'), item.get('/Popup')
                if parent is not None:
                    flags = item.get('/F')
                    reply = dict(identity=identity(item), flags=str(flags) if flags is not None else None, parent=identity(parent), parentOnPage=parent.objgen in refs, replyType=text(item.get('/RT')), popupOnPage=popup.objgen in refs if popup is not None else None, popupParentMatches=popup.get('/Parent').objgen == item.objgen if isinstance(popup, pikepdf.Dictionary) and popup.get('/Parent') is not None else None)
                    replies.append(json.dumps(reply, ensure_ascii=False, separators=(',',':')))
                if name == 'Link':
                    action = item.get('/A', {})
                    kind = text(action.get('/S')) or 'GoTo'
                    link = dict(kind=kind, rect=[round(float(n),2) for n in item.get('/Rect',[])])
                    if kind == 'URI':
                        link['uri'] = text(action.get('/URI'))
                    if kind == 'GoTo':
                        link['targetPage'] = destination(action.get('/D',item.get('/Dest')))
                    links.append(link)
            box = list(page.mediabox)
            out_pages.append(dict(size=dict(width=float(box[2]-box[0]),height=float(box[3]-box[1])), rotation=int(page.obj.get('/Rotate',0)), annotations=annotations, replies=sorted(replies), links=links))

        fields, visited = [], set()
        def read_field(field, prefix='', inherited=None):
            if field.is_indirect and field.objgen in visited:
                return
            visited.add(field.objgen)
            props = dict(inherited or {})
            for key in ['/FT','/Ff','/V','/Opt']:
                if key in field:
                    props[key] = field[key]
            partial = text(field.get('/T'))
            name = '.'.join(part for part in [prefix, partial] if part)
            kids = field.get('/Kids', [])
            children = [child for child in kids if '/T' in child or child.get('/Subtype') != pikepdf.Name('/Widget')]
            if children:
                for child in children:
                    read_field(child, name, props)
                return
            ft = text(props.get('/FT')); flags = int(props.get('/Ff',0)); value = props.get('/V')
            kind = 'PDFField'
            if ft == 'Tx':
                kind, value = 'PDFTextField', text(value)
            elif ft == 'Btn':
                if flags & (1<<16):
                    kind, value = 'PDFButton', None
                elif flags & (1<<15):
                    kind, value = 'PDFRadioGroup', text(value)
                    states = [str(k).lstrip("/") for child in kids for k in child.get('/AP',{}).get('/N',{}).keys() if str(k) != '/Off']
                    opts = props.get('/Opt',[])
                    if value in states and states.index(value) < len(opts): value = text(opts[states.index(value)])
                    if value == 'Off': value = None
                else:
                    kind, value = 'PDFCheckBox', text(value) not in [None,'Off']
            elif ft == 'Ch':
                kind = 'PDFDropdown' if flags & (1<<17) else 'PDFOptionList'
                value = [text(v) for v in value] if isinstance(value,pikepdf.Array) else [text(value)] if value is not None else []
            elif ft == 'Sig':
                kind, value = 'PDFSignature', None
            fields.append(dict(name=name,type=kind,value=value))

        for field in pdf.Root.get('/AcroForm',{}).get('/Fields',[]):
            read_field(field)
        return dict(pages=out_pages,fields=sorted(fields,key=lambda f:f['name']),title=text(pdf.docinfo.get('/Title')),warnings=pdf.check_pdf_syntax())


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1]), ensure_ascii=False))
