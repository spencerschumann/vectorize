#!/bin/bash

# Require command line arguments: input_file page_number
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 input_file page_number"
    exit 1
fi

INPUT_FILE="$1"
PAGE_NUMBER="$2"

extract_color() {
    local color="$1"
    local rgb="$2"

    echo "Extracting $color lines..."
    magick -monitor out/page.png \
        -fuzz 10% -fill white -opaque "#000000" \
        -fuzz 20% -fill black -opaque "#$rgb" \
        -colorspace Gray \
        -threshold 10% \
        out/page_$color.png
}

trace_lines() {
    local color="$1"
    
    # if there's a second argument, use it as output color
    local stroke_color="${2:-$color}"
 
    echo "Tracing $color lines..."
    autotrace --centerline \
        --corner-always-threshold 170 \
        --corner-threshold 170 \
        --line-threshold 2 \
        --noise-removal 0 \
        --line-reversion-threshold 0.0001 \
        --tangent-surround 1 \
        --filter-iterations 0 \
        --corner-surround 0 \
        --output-file out/page_${color}_raw.svg \
        out/page_${color}.png

    python vectorize.py \
        --source-dpi 200.0 \
        --stroke-color "$stroke_color" \
        --stroke-width 1 \
        out/page_${color}_raw.svg \
        out/page_${color}.svg
}

docker run --rm -i -v "$(pwd -W)":/data vectorize-magick-autotrace bash -l <<EOF
    $(declare -f extract_color)
    $(declare -f trace_lines)
    PAGE_NUMBER=$PAGE_NUMBER
 
    echo "Processing file: $INPUT_FILE, page number: $PAGE_NUMBER"

    cd /data
    mkdir out

    echo "Generating palette..."
    magick \
        xc:#000000 \
        xc:#ff0000 \
        xc:#00cc00 \
        xc:#0000ff \
        xc:#ffffff \
        xc:#ff00ff \
        xc:#00ffff \
        xc:#ffaa00 \
        +append \
        out/palette.png

    echo "Generating PNG from PDF page..."
    magick \
        -density 200.02 \
        pdf:${INPUT_FILE}[${PAGE_NUMBER}] \
        -white-threshold 85% \
        -crop 6000x4000+620+280 +repage \
        -statistic median 3x3 \
        +dither -remap out/palette.png \
        out/page.png

    echo "Extracting black lines..."
    magick -monitor out/page.png \
        -white-threshold 10% \
        -colorspace Gray \
        -threshold 5% \
        out/page_black.png &

    extract_color red ff0000 &
    extract_color green 00cc00 &
    extract_color blue 0000ff &
    extract_color magenta ff00ff &

    wait

    trace_lines black &
    trace_lines red &
    trace_lines green &
    trace_lines blue &
    trace_lines magenta &

    wait
EOF

echo "Processing complete."
