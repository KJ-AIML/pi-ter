#!/usr/bin/env bash
# Pi-ter Launcher with Fast ASCII Flame Ignition Animation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check non-interactive flags
IS_NON_INTERACTIVE=0
for arg in "$@"; do
    if [[ "$arg" =~ ^(-p|--print|-v|--version|-h|--help)$ ]]; then
        IS_NON_INTERACTIVE=1
        break
    fi
done

if [ "$IS_NON_INTERACTIVE" -eq 0 ] && [ -t 1 ]; then
    tput civis 2>/dev/null || true # Hide cursor

    ESC=$'\033'
    cReset="${ESC}[0m"
    cBold="${ESC}[1m"
    cDim="${ESC}[2m"
    cYellow="${ESC}[38;2;254;240;138m"
    cOrange="${ESC}[38;2;255;112;67m"
    cRed="${ESC}[38;2;239;68;68m"
    cCyan="${ESC}[38;2;45;212;191m"
    cPink="${ESC}[38;2;244;114;182m"

    clear

    render_frame() {
        tput cup 2 0 2>/dev/null || clear
        echo -e "${cDim}------------------------------------------------${cReset}"
        echo -e "   $1"
        echo -e "   $2"
        echo -e "   $3"
        echo -e "   $4"
        echo -e "   $5"
        echo -e "${cDim}------------------------------------------------${cReset}"
    }

    render_frame \
        "                      .                       " \
        "                     ( )                      " \
        "                      .                       " \
        "               [ ${cDim}. . . . . . .${cReset} ]               " \
        "             ${cDim}⚡ IGNITING ENGINE ⚡${cReset}             "
    sleep 0.08

    render_frame \
        "                    (   )                     " \
        "                   (  .  )                    " \
        "                  (       )                   " \
        "              [ ${cYellow}▓▓${cDim}░░░░░░░░░░░${cReset} ]              " \
        "             ${cYellow}⚡ IGNITING ENGINE ⚡${cReset}             "
    sleep 0.08

    render_frame \
        "                   (  .  )                    " \
        "                  (   .   )                   " \
        "                 (  (   )  )                  " \
        "             [ ${cOrange}▓▓▓▓▓${cDim}░░░░░░░░${cReset} ]             " \
        "            ${cOrange}🔥 HEATING UP CORES 🔥${cReset}            "
    sleep 0.08

    render_frame \
        "                  (  .      )                 " \
        "                 )           (                " \
        "                (   .  )     . )              " \
        "            [ ${cOrange}▓▓▓▓▓▓▓▓${cDim}░░░░░${cReset} ]            " \
        "            ${cOrange}🔥 HEATING UP CORES 🔥${cReset}            "
    sleep 0.08

    render_frame \
        "                 (  .      )                  " \
        "                )     .     (                 " \
        "               (   .  )     . )               " \
        "           [ ${cRed}▓▓▓▓▓▓▓▓▓▓▓${cDim}░░${cReset} ]           " \
        "           ${cRed}🔥 PI-TER GOING ON FIRE 🔥${cReset}          "
    sleep 0.08

    render_frame \
        "                )   (   .   )  (              " \
        "               (  .      ( .   ) )            " \
        "              (    (  )   )   )   )           " \
        "          [ ${cPink}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${cReset} ]           " \
        "           ${cBold}${cRed}🔥 PI-TER IS ON FIRE! 🔥${cReset}          "
    sleep 0.08

    render_frame \
        "               )   (   .   )  (               " \
        "              (  .      ( .   ) )             " \
        "              (    (  )   )   )   )           " \
        "               \\  / \\/ \\  / \\ / \\ /           " \
        "         ${cBold}${cCyan}⚡ P I - T E R   R E A D Y ⚡${cReset}          "
    sleep 0.15

    tput cnorm 2>/dev/null || true # Restore cursor
    clear
fi

exec pi -e "$REPO_DIR" "$@"
