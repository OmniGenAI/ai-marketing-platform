from groq import Groq

client = Groq()
completion = client.chat.completions.create(
    model="meta-llama/llama-4-scout-17b-16e-instruct",
    messages=[
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": """{
  "task": "Extract brand colors from an image",
  "instructions": "Analyze the provided image and identify the primary brand colors used in the design. Ignore the background unless it is clearly part of the brand identity. Extract the dominant colors from key visual elements (such as logos, shapes, or text) and return them as hex color codes.",
  "output_format": {
    "colors": [
      {
        "label": "primary red",
        "hex": "#ED1C24",
        "percentage": "approximate visual coverage"
      },
      {
        "label": "primary green",
        "hex": "#0F9D58",
        "percentage": "approximate visual coverage"
      },
      {
        "label": "primary blue",
        "hex": "#2B6CB0",
        "percentage": "approximate visual coverage"
      },
      {
        "label": "accent yellow",
        "hex": "#F6AD0F",
        "percentage": "approximate visual coverage"
      }
    ]
  },
  "notes": "Return only the most visually significant colors (3–6 max) and approximate their coverage in the image."
}"""
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://www.zohowebstatic.com/sites/zweb/images/ogimage/zoho-logo.png"
            }
          }
        ]
      },
    ],
    temperature=1,
    max_completion_tokens=1024,
    top_p=1,
    stream=True,
    stop=None
)

for chunk in completion:
    print(chunk.choices[0].delta.content or "", end="")
