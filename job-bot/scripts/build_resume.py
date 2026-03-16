#!/usr/bin/env python3
"""
build_resume.py
Fills template.docx with tailored content using proper OOXML formatting,
matching the original resume style (bold company names, tab-aligned dates,
ListParagraph bullets, bold skill labels).

Usage: python3 build_resume.py <input.json> <template.docx> <output.docx>
"""
import sys
import json
import zipfile
import re
import html as html_lib

# ─── XML helpers ──────────────────────────────────────────────────────────────

def esc(text: str) -> str:
    return html_lib.escape(str(text), quote=False)

def txt_run(text: str, bold: bool = False, sz: int = 20) -> str:
    b = '<w:b/>' if bold else ''
    return (
        f'<w:r><w:rPr>{b}<w:sz w:val="{sz}"/></w:rPr>'
        f'<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'
    )

def tab_run(bold: bool = False, sz: int = 20) -> str:
    b = '<w:b/>' if bold else ''
    return f'<w:r><w:rPr>{b}<w:sz w:val="{sz}"/></w:rPr><w:tab/></w:r>'

# ─── Paragraph builders ────────────────────────────────────────────────────────

def company_para(company: str, location: str) -> str:
    """Bold company name [TAB→right] Bold location"""
    ppr = (
        '<w:pPr>'
        '<w:tabs><w:tab w:val="left" w:pos="9553"/></w:tabs>'
        '<w:spacing w:before="79"/>'
        '<w:ind w:left="360"/>'
        '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'
        '</w:pPr>'
    )
    return f'<w:p>{ppr}{txt_run(company, bold=True)}{tab_run(bold=True)}{txt_run(location, bold=True)}</w:p>'


def role_para(role: str, dates: str) -> str:
    """Bold role title [TAB→right] Bold dates"""
    ppr = (
        '<w:pPr>'
        '<w:tabs><w:tab w:val="left" w:pos="9218"/></w:tabs>'
        '<w:spacing w:before="26"/>'
        '<w:ind w:left="360"/>'
        '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'
        '</w:pPr>'
    )
    return f'<w:p>{ppr}{txt_run(role, bold=True)}{tab_run(bold=True)}{txt_run(dates, bold=True)}</w:p>'


def bullet_para(text: str) -> str:
    """Dash bullet using ListParagraph + numId=1 (matches original template style)"""
    ppr = (
        '<w:pPr>'
        '<w:pStyle w:val="ListParagraph"/>'
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
        '<w:spacing w:before="48" w:line="230" w:lineRule="auto"/>'
        '<w:ind w:right="361"/>'
        '</w:pPr>'
    )
    return f'<w:p>{ppr}{txt_run(text)}</w:p>'


def degree_para(degree: str, school: str, dates: str) -> str:
    """Bold degree — school [TAB→right] Bold dates"""
    ppr = (
        '<w:pPr>'
        '<w:tabs><w:tab w:val="left" w:pos="9293"/></w:tabs>'
        '<w:spacing w:before="79"/>'
        '<w:ind w:left="360"/>'
        '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'
        '</w:pPr>'
    )
    label = f'{degree} — {school}'
    return f'<w:p>{ppr}{txt_run(label, bold=True)}{tab_run(bold=True)}{txt_run(dates, bold=True)}</w:p>'


def skill_para(label: str, value: str, first: bool = False) -> str:
    """Bold 'Label:' followed by regular value text"""
    before = '34' if first else '8'
    ppr = (
        f'<w:pPr>'
        f'<w:pStyle w:val="BodyText"/>'
        f'<w:spacing w:before="{before}"/>'
        f'<w:ind w:left="360"/>'
        f'</w:pPr>'
    )
    return f'<w:p>{ppr}{txt_run(label + ": ", bold=True)}{txt_run(value)}</w:p>'


def project_title_para(name: str, date: str = '') -> str:
    """Bold project name [TAB→right] Bold date"""
    if date:
        ppr = (
            '<w:pPr>'
            '<w:tabs><w:tab w:val="left" w:pos="9859"/></w:tabs>'
            '<w:spacing w:before="79"/>'
            '<w:ind w:left="360"/>'
            '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'
            '</w:pPr>'
        )
        return f'<w:p>{ppr}{txt_run(name, bold=True)}{tab_run(bold=True)}{txt_run(date, bold=True)}</w:p>'
    else:
        ppr = (
            '<w:pPr>'
            '<w:spacing w:before="79"/>'
            '<w:ind w:left="360"/>'
            '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'
            '</w:pPr>'
        )
        return f'<w:p>{ppr}{txt_run(name, bold=True)}</w:p>'


# ─── Section builders ──────────────────────────────────────────────────────────

def build_experience(entries: list) -> str:
    paras = []
    for entry in entries:
        paras.append(company_para(entry.get('company', ''), entry.get('location', '')))
        paras.append(role_para(entry.get('role', ''), entry.get('dates', '')))
        for b in entry.get('bullets', []):
            paras.append(bullet_para(b))
    return ''.join(paras)


def build_education(entries: list) -> str:
    paras = []
    for entry in entries:
        paras.append(degree_para(entry.get('degree', ''), entry.get('school', ''), entry.get('dates', '')))
        if entry.get('details'):
            ppr = '<w:pPr><w:ind w:left="360"/><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr>'
            paras.append(f'<w:p>{ppr}{txt_run(entry["details"])}</w:p>')
    return ''.join(paras)


def build_skills(skills: dict) -> str:
    mapping = [
        ('languages',   'Languages'),
        ('frameworks',  'Frameworks'),
        ('databases',   'Databases'),
        ('cloud_devops','Cloud/DevOps'),
        ('tools',       'Tools'),
    ]
    paras = []
    first = True
    for key, label in mapping:
        if skills.get(key):
            paras.append(skill_para(label, skills[key], first=first))
            first = False
    return ''.join(paras)


def build_projects(projects: list) -> str:
    paras = []
    for proj in projects:
        paras.append(project_title_para(proj.get('name', ''), proj.get('date', '')))
        for b in proj.get('bullets', []):
            paras.append(bullet_para(b))
    return ''.join(paras)


# ─── Placeholder replacement ───────────────────────────────────────────────────

def replace_placeholder(xml: str, key: str, replacement: str) -> str:
    """Replace the entire <w:p> paragraph containing {{{key}}} with replacement XML."""
    search = '{{{' + key + '}}}'
    pos = xml.find(search)
    if pos == -1:
        print(f'WARNING: placeholder {{{{{{{key}}}}}}} not found', file=sys.stderr)
        return xml

    para_start = xml.rfind('<w:p ', 0, pos)
    if para_start == -1:
        para_start = xml.rfind('<w:p>', 0, pos)
    para_end = xml.find('</w:p>', pos) + len('</w:p>')

    return xml[:para_start] + replacement + xml[para_end:]


def replace_name(xml: str, name: str) -> str:
    """Replace {{{name}}} text in-place, preserving the surrounding paragraph formatting."""
    return xml.replace('{{{name}}}', esc(name))


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) != 4:
        print('Usage: python3 build_resume.py <input.json> <template.docx> <output.docx>')
        sys.exit(1)

    json_path, template_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    with zipfile.ZipFile(template_path) as z:
        xml = z.read('word/document.xml').decode('utf-8')

    # Replace name (simple text swap, keeps original paragraph style)
    xml = replace_name(xml, data.get('name', 'GNYANI ENUGANDULA'))

    # Replace content sections with properly formatted OOXML
    xml = replace_placeholder(xml, 'experience', build_experience(data.get('experience', [])))
    xml = replace_placeholder(xml, 'education',  build_education(data.get('education', [])))
    xml = replace_placeholder(xml, 'skills',     build_skills(data.get('skills', {})))
    xml = replace_placeholder(xml, 'projects',   build_projects(data.get('projects', [])))

    # Repack docx
    with zipfile.ZipFile(template_path) as zin:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr(item, xml.encode('utf-8'))
                else:
                    zout.writestr(item, zin.read(item.filename))

    print(f'OK:{output_path}')


if __name__ == '__main__':
    main()
