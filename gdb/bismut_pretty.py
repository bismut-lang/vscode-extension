"""
GDB pretty-printers for Bismut runtime types.

Teaches GDB how to display List, Dict, and Str values with their
contents instead of raw pointer addresses.

Loaded via setupCommands in the cppdbg launch configuration.
"""

import gdb
import gdb.printing
import re


class BismutStrPrinter:
    """Pretty-printer for __lang_rt_Str (and pointers to it)."""

    def __init__(self, val):
        self.val = val
        self._is_null = False

    def to_string(self):
        try:
            v = self.val
            if v.type.code == gdb.TYPE_CODE_PTR:
                if int(v) == 0:
                    self._is_null = True
                    return 'None'
                v = v.dereference()
            length = int(v['len'])
            data = v['data']
            if int(data) == 0:
                return ''
            s = data.string('utf-8', 'replace', length)
            return s
        except Exception:
            return '<str?>'

    def display_hint(self):
        if self._is_null:
            return None
        return 'string'


class BismutListPrinter:
    """Pretty-printer for __lang_rt_List_* (and pointers to it)."""

    def __init__(self, val, elem_type_name):
        self.val = val
        self.elem_type_name = elem_type_name

    def to_string(self):
        try:
            v = self.val
            if v.type.code == gdb.TYPE_CODE_PTR:
                if int(v) == 0:
                    return 'None'
                v = v.dereference()
            length = int(v['len'])
            return 'List[{}]({})'.format(self.elem_type_name, length)
        except Exception:
            return '<list?>'

    def children(self):
        try:
            v = self.val
            if v.type.code == gdb.TYPE_CODE_PTR:
                if int(v) == 0:
                    return
                v = v.dereference()
            length = int(v['len'])
            data = v['data']
            if int(data) == 0:
                return
            for i in range(min(length, 200)):
                yield ('[{}]'.format(i), data[i])
        except Exception:
            return

    def display_hint(self):
        return 'array'


class BismutDictPrinter:
    """Pretty-printer for __lang_rt_Dict_* (and pointers to it)."""

    def __init__(self, val, key_type_name, val_type_name):
        self.val = val
        self.key_type_name = key_type_name
        self.val_type_name = val_type_name

    def to_string(self):
        try:
            v = self.val
            if v.type.code == gdb.TYPE_CODE_PTR:
                if int(v) == 0:
                    return 'None'
                v = v.dereference()
            length = int(v['len'])
            return 'Dict[{}, {}]({})'.format(
                self.key_type_name, self.val_type_name, length)
        except Exception:
            return '<dict?>'

    def children(self):
        try:
            v = self.val
            if v.type.code == gdb.TYPE_CODE_PTR:
                if int(v) == 0:
                    return
                v = v.dereference()
            cap = int(v['cap'])
            entries = v['e']
            if int(entries) == 0:
                return
            idx = 0
            for i in range(cap):
                entry = entries[i]
                st = int(entry['st'])
                if st == 1:  # __LANG_RT_SLOT_FULL
                    yield ('[{}].key'.format(idx), entry['key'])
                    yield ('[{}].value'.format(idx), entry['value'])
                    idx += 1
        except Exception:
            return

    def display_hint(self):
        return 'map'


# --- Tag-to-Bismut-name mapping ---

_TAG_TO_NAME = {
    'I8': 'i8', 'I16': 'i16', 'I32': 'i32', 'I64': 'i64',
    'U8': 'u8', 'U16': 'u16', 'U32': 'u32', 'U64': 'u64',
    'F32': 'f32', 'F64': 'f64', 'BOOL': 'bool', 'STR': 'str',
}


def _tag_to_name(tag):
    """Convert a C tag like I64 or STR or Person to a Bismut type name."""
    return _TAG_TO_NAME.get(tag, tag)


# --- Regex matchers ---

_LIST_RE = re.compile(r'^__lang_rt_List_(\w+)$')
_DICT_RE = re.compile(r'^__lang_rt_Dict_(\w+?)_(\w+)$')
_STR_RE = re.compile(r'^__lang_rt_Str$')


def _get_base_type_name(val):
    """Get the struct type name, stripping pointer indirection."""
    t = val.type
    if t.code == gdb.TYPE_CODE_PTR:
        t = t.target()
    name = t.tag or str(t)
    # Strip 'struct ' prefix if present
    if name.startswith('struct '):
        name = name[7:]
    return name


def _lookup_printer(val):
    """Try to match a Bismut runtime type and return a printer."""
    name = _get_base_type_name(val)

    if _STR_RE.match(name):
        return BismutStrPrinter(val)

    m = _LIST_RE.match(name)
    if m:
        elem_tag = m.group(1)
        return BismutListPrinter(val, _tag_to_name(elem_tag))

    m = _DICT_RE.match(name)
    if m:
        key_tag = m.group(1)
        val_tag = m.group(2)
        return BismutDictPrinter(val, _tag_to_name(key_tag), _tag_to_name(val_tag))

    return None


# --- Register with GDB ---

def register_printers(objfile=None):
    pp = gdb.printing.RegexpCollectionPrettyPrinter('bismut')
    # We use a custom lookup function instead of regex patterns
    # because the type names are dynamic (macro-generated).
    gdb.pretty_printers.append(_lookup_printer)


register_printers()
