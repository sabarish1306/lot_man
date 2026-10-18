"""Manual OCR smoke check: python -m tests.test_ocr."""

from importlib.resources import path
import json
import os
import time
from pathlib import Path


def main():
    # Keep heavy OCR imports out of automated test discovery.
    from logging_config import configure_logging
    from services.ocr_service import extract_image

    configure_logging()
    project_root = Path(__file__).resolve().parents[1]

    ticket_samples_dir = project_root / "tests" / "ticket samples"
    output_dir = project_root / "tests" / "output_results"

    # Create the output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Filter to process only image files from your ticket samples folder
    valid_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff'}

    # Grab all items and filter out directories/non-images
    images = [
        f for f in ticket_samples_dir.iterdir() 
        if f.is_file() and f.suffix.lower() in valid_extensions
    ]

    print(f"Found {len(images)} images to process. Saving results to: {output_dir}\n")

    for image_path in images:
        print(f"Processing: {image_path.name}...")
        
        # 1. Start the performance timer
        start_time = time.perf_counter()
        
        try:
            # 2. Execute OCR processing
            ocr_result = extract_image(str(image_path))
            error_message = None
        except Exception as e:
            ocr_result = None
            error_message = str(e)
            print(f"Error processing {image_path.name}: {e}")
            
        # 3. Stop the timer and compute execution time
        end_time = time.perf_counter()
        execution_time_seconds = end_time - start_time

        print(json.dumps(ocr_result, indent=2, ensure_ascii=False))
        
        # 4. Construct the structured file content
        file_payload = {
            "filename": image_path.name,
            "processing_time_seconds": round(execution_time_seconds, 4),
            "success": ocr_result is not None,
            "result": ocr_result
        }
        if error_message:
            file_payload["error"] = error_message

        # 5. Define output file destination (e.g., tests/output_results/1.jpg.json)
        output_file_path = output_dir / f"{image_path.name}.json"
        
        # 6. Write performance metrics and data directly to the file
        with open(output_file_path, "w", encoding="utf-8") as f:
            json.dump(file_payload, f, indent=2, ensure_ascii=False)
            
        print(f"↳ Saved metrics to {output_file_path.name} ({round(execution_time_seconds, 2)}s)")

    print("\nAll images processed successfully!")


if __name__ == "__main__":
    main()
