# SPDX-License-Identifier: BSD-3-Clause
# Copyright (c) 2024-2025 Bjoern Boss Henrichsen
import json

# Load the questions from the file
file_path = '../admin/questions.json'
with open(file_path, 'r', encoding='utf-8') as f:
    questions = json.load(f)

# Define categorization logic
categories = {
    "Food and Culinary Arts": ["ingredient", "cuisine", "cooking", "spice", "dish", "meal"],
    "Technology and Innovations": ["platform", "invention", "innovate", "technology", "software", "science"],
    "Literature": ["novel", "author", "book", "literature", "story", "fiction", "character"],
    "Health and Science": ["anatomy", "body", "biology", "medicine", "medical", "science"],
    "Yoga and Wellness": ["yoga", "asana", "pranayama", "wellness", "meditation"],
    "History and Wars": ["history", "war", "battle", "century", "historical", "revolution"],
    "Entertainment and Media": ["movie", "film", "music", "media", "entertainment"],
    "Geography and Places": ["capital", "city", "country", "place", "landmark", "geography"],
    "Space and Astronomy": ["space", "planet", "solar", "astronomy", "universe", "orbit"],
    "Criminals and Scandals": ["fraud", "crime", "scandal", "criminal", "heist"]
}

# Helper function to assign categories
def assign_category(question_desc):
    for category, keywords in categories.items():
        if any(keyword in question_desc.lower() for keyword in keywords):
            return category
    return "Uncategorized"

# Add categories to the questions
for question in questions:
    question['category'] = assign_category(question['desc'])

# Save the updated questions back
output_path = './categorized_questions.json'
with open(output_path, 'w') as f:
    json.dump(questions, f, indent=4)
