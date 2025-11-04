# SPDX-License-Identifier: BSD-3-Clause
# Copyright (c) 2024-2025 Bjoern Boss Henrichsen
import re

o = '['

# page1.html: https://blog.livereacting.com/100-fun-general-knowledge-quiz-questions/
# page2.html: https://www.runaway.games/blog/100-trivia-questions-answers-medium-hard-difficulty

f = open('page1.html', mode='r', encoding='utf-8').read()
m = re.findall('<li>([^<>]*)<br>a\\) ([^<>]*)<br>b\\) ([^<>]*)<br>c\\) ([^<>]*)<br>d\\) ([^<>]*)</li>', f)
for (q, a, b, c, d) in m:
	qt = q.replace('"', '\\"')
	at = a.split('✅')[0].replace('"', '\\"')
	bt = b.split('✅')[0].replace('"', '\\"')
	ct = c.split('✅')[0].replace('"', '\\"')
	dt = d.split('✅')[0].replace('"', '\\"')

	if len(o) > 1:
		o += ','
	o += '\n\t{\n'
	o += f'\t\t"desc": "{qt}",\n'
	o += '\t\t"text": [\n'
	o += f'\t\t\t"{at}",\n'
	o += f'\t\t\t"{bt}",\n'
	o += f'\t\t\t"{ct}",\n'
	o += f'\t\t\t"{dt}"\n'
	o += '\t\t],\n'
	o += '\t\t"correct": '
	if a.find('✅') >= 0:
		o += '0'
	elif b.find('✅') >= 0:
		o += '1'
	elif c.find('✅') >= 0:
		o += '2'
	elif d.find('✅') >= 0:
		o += '3'
	o += '\n\t}'

f = open('page2.html', mode='r', encoding='utf-8').read()
m = re.findall('<strong>\\d+\\.(.*)</strong></p>\\s*<p>(<strong>.*</strong>)?Answer:(&nbsp;)?(.*)</p>\\s*<p>a\\) (.*)</p>\\s*<p>b\\) (.*)</p>\\s*<p>c\\) (.*)</p>\\s*<p>d\\) (.*)</p>', f)

for (q, _, _, s, a, b, c, d) in m:
	qt = q.strip().replace('"', '\\"').replace('&amp;', '&')
	at = a.strip().replace('"', '\\"').replace('&amp;', '&')
	bt = b.strip().replace('"', '\\"').replace('&amp;', '&')
	ct = c.strip().replace('"', '\\"').replace('&amp;', '&')
	dt = d.strip().replace('"', '\\"').replace('&amp;', '&')
	st = s.strip()

	ac, bc, cc, dc = (st.lower() in at.lower() or at.lower() in st.lower(), st.lower() in bt.lower() or bt.lower() in st.lower(), st.lower() in ct.lower() or ct.lower() in st.lower(), st.lower() in dt.lower() or dt.lower() in st.lower())
	if (1 if ac else 0) + (1 if bc else 0) + (1 if cc else 0) + (1 if dc else 0) != 1:
		# print(f'{qt}:\n\tSolution: {st}\n\t{at}\n\t{bt}\n\t{ct}\n\t{dt}\n\n')
		continue

	o += ','
	o += '\n\t{\n'
	o += f'\t\t"desc": "{qt}",\n'
	o += '\t\t"text": [\n'
	o += f'\t\t\t"{at}",\n'
	o += f'\t\t\t"{bt}",\n'
	o += f'\t\t\t"{ct}",\n'
	o += f'\t\t\t"{dt}"\n'
	o += '\t\t],\n'
	o += '\t\t"correct": '
	if ac:
		o += '0'
	elif bc:
		o += '1'
	elif cc:
		o += '2'
	elif dc:
		o += '3'
	o += '\n\t}'
	

o += '\n]\n'

open('../admin/questions.json', mode='w', encoding='utf-8').write(o)
