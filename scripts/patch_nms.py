import os

file_path = r"j:\Projects\smart-photo-organizer\src\python\facelib\nms.py"

with open(file_path, 'r') as f:
    content = f.read()

target = "if io_min > 0.65:"
replacement = "if io_min > 0.55:"

if target in content:
    new_content = content.replace(target, replacement)
    
    # Also update the comment above it to match
    target_comment = "Overlap 0.68 overlap)."
    replacement_comment = "Overlap 0.57 overlap)."
    if target_comment in new_content:
        new_content = new_content.replace(target_comment, replacement_comment)

    with open(file_path, 'w') as f:
        f.write(new_content)
    print("Successfully patched nms.py")
else:
    print("Target string not found!")
    # Debug print around likely location
    start = content.find("if dist > 0.9:")
    print("Context around failure:")
    print(content[start:start+400])
