#!/bin/bash

# Require command line arguments: input_file page_number
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 input_file page_number"
    exit 1
fi

INPUT_FILE="$1"
PAGE_NUMBER="$2"

docker run --rm -i -v "$(pwd -W)":/data vectorize-magick-autotrace bash -l <<EOF
    echo "Processing file: $INPUT_FILE, page number: $PAGE_NUMBER"

    cd /data
    
    echo "Generating PNG from PDF page..."
    magick \
        -density 200.02 \
        pdf:${INPUT_FILE}[${PAGE_NUMBER}] \
        -white-threshold 85% \
        -crop 6000x4000+620+280 +repage \
        -colors 12 -dither None \
        page_${PAGE_NUMBER}.png

    echo "Extracting black lines..."
    magick -monitor page_${PAGE_NUMBER}.png \
        -white-threshold 10% \
        -colorspace Gray \
        -threshold 5% \
        page_${PAGE_NUMBER}_black.png

    echo "Extracting red lines..."
    magick -monitor page_${PAGE_NUMBER}.png \
        -fuzz 10% -fill white -opaque "#000000" \
        -fuzz 20% -fill black -opaque "#ff0000" \
        -colorspace Gray \
        -threshold 10% \
        page_${PAGE_NUMBER}_red.png

    # echo "Extracting green lines..."
    

    # magenta lines may be more difficult - need to remove stippling

    # echo "Extracting black lines..."
    autotrace --centerline \
          --background-color FFFFFF \
          --despeckle-level 2 \
          --line-reversion-threshold 1 \
          --corner-surround 30 \
          --output-format svg \
          --output-file page_${PAGE_NUMBER}_black.svg \
          page_${PAGE_NUMBER}_black.png
EOF

# Autotrace args to disable filtering
# autotrace --centerline \
#     --corner-always-threshold 170 \
#     --corner-threshold 170 \
#     --line-reversion-threshold 0.0001 \
#     --line-threshold 2 \
#     --noise-removal 0 \
#     --tangent-surround 1 \
#     --filter-iterations 0 \
#     --corner-surround 0 
#     ../cleanplans/vectorize/page_7_black_filtered.png \
#     --output-file ../cleanplans/vectorize/page_7_black_2.svg
