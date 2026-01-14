import sys
import os
import re

# Add the project root to sys.path
sys.path.append(os.getcwd())

from app.translators.legacy import LegacyTranslator

def test_parse_email_content():
    sample_content = """
    <div>Thank you so much! Sharing the video helped me on able to getting that link!<br>
    Kind regards, Sophia Howard<br><br>
    On Mon, Dec 22, 2025 at 5:33 PM Prospect ID Video &lt;videoteam@prospectid.com&gt; wrote:<br>
    No worries, I can send you a Dropbox folder shortly. Once your video finishes processing try clicki</div>
    """
    
    print("--- Original content ---")
    print(sample_content)
    print("\n--- Processed content ---")
    processed = LegacyTranslator._parse_email_content(sample_content)
    print(processed)
    
    # Check for double newlines or trailing spaces
    assert "  " in processed, "Should contain double spaces for line breaks"
    assert "\n\n" in processed, "Should contain double newlines for paragraph separation"
    
    print("\n✅ Verification successful!")

if __name__ == "__main__":
    test_parse_email_content()
