import inspect
import json
import re
from app.config import LOG_VCPRINT
import sys
from app.common.system_logger import get_logger

logger = get_logger()


def clean_data_for_logging(data):
    """
    Clean the data to make it safe for logging.
    Removes emojis and other special characters that could cause logging errors.
    """
    if isinstance(data, str):
        data = re.sub(r'[^\x00-\x7F]+', '', data)
    return data


def vcprint(
        data=None,
        title="Unnamed Data",
        verbose=True,
        color=None,
        background=None,
        style=None,
        pretty=False,
        indent=4,
        inline=False
) -> None:
    """
    Optionally prints data with styling based on verbosity and formatting preferences, and logs the output.

    Args:
        verbose (bool): Controls verbosity of the print output. Default is False.
        data: The data to be printed. Can be of any type that can be converted to a string. Default is None.
        title (str): A title for the data being printed. Default is "Unnamed Data".
        color (str): Text color. Default is "white".
        background (str): Background color. Default is "black".
        style (str): Text style (e.g., "bold"). Default is "bold".
        pretty (bool): Enables pretty printing of the data if True. Default is False.
        indent (int): Sets the indent level for pretty printing. Default is 4.
        inline (bool): Whether to print the title and data on the same line. Default is False.

    Returns:
        None
    """
    if not data:
        data = "No data provided."

    if inline:
        log_message = f"{title}: {data}"
    else:
        if title == "Unnamed Data":
            log_message = f"{data}"
        else:
            log_message = f"\n{title}:\n{data}"

    log_message = clean_data_for_logging(log_message)

    if LOG_VCPRINT:
        try:
            logger.info(log_message)
        except Exception as e:
            logger.error("[SYSTEM LOGGER] Internal Error...")

    if verbose:
        if pretty:
            try:
                parsed_data = json.loads(data)
                pretty_print(parsed_data, title, color, background, style, indent, inline=inline)
            except (json.JSONDecodeError, TypeError) as e:
                pretty_print(data, title, color, background, style, indent, inline=inline)

        else:
            if title == "Unnamed Data":
                cool_print(
                    text=f"{data}",
                    color=color,
                    background=background,
                    style=style)
            else:
                if inline:
                    cool_print(
                        text=f"{title}: {data}",
                        color=color,
                        background=background,
                        style=style)
                else:
                    cool_print(
                        text=f"\n{title}:\n{data}",
                        color=color,
                        background=background,
                        style=style)


def pretty_print(data, title="Unnamed Data", color="white", background="black", style=None, indent=4, inline=False):
    frame = inspect.currentframe()
    try:
        context = inspect.getouterframes(frame)
        if title == "Unnamed Data":
            name = title
            for var_name, var_val in context[1].frame.f_locals.items():
                if var_val is data:
                    name = var_name
                    break
        else:
            name = title

        if isinstance(data, str) and not data.strip().startswith(('{', '[')):
            if color:
                if inline:
                    cool_print(text=f"{name}: {data}", color=color, background=background, style=style)
                else:
                    cool_print(text=f"\n{name}:\n{data}", color=color, background=background, style=style)
            else:
                if inline:
                    print(f"{name}: {data}")
                else:
                    print(f"\n{name}:\n{data}")
            return

        converted_data, old_type, new_type = convert_to_json_compatible(data)
        type_message = f" [{old_type} converted to {new_type}]" if old_type != new_type else ""
        json_string = json.dumps(converted_data, indent=indent)

        compact_json_string = re.sub(r'"\\"([^"]*)\\""', r'"\1"', json_string)
        compact_json_string = re.sub(r'\[\n\s+((?:\d+,?\s*)+)\n\s+\]', lambda m: '[' + m.group(1).replace('\n', '').replace(' ', '') + ']', compact_json_string)

        if color:
            if inline:
                cool_print(text=f"{name}:{type_message} {compact_json_string}", color=color, background=background, style=style)
            else:
                cool_print(text=f"\n{name}:{type_message}\n{compact_json_string}", color=color, background=background, style=style)
        else:
            if inline:
                print(f"{name}:{type_message} {compact_json_string}")
            else:
                print(f"\n{name}:{type_message}\n{compact_json_string}")

    finally:
        del frame


class MatrixPrintLogger:
    def __init__(self):
        self.buffer = []
        self.verbose = True
        self.color = None
        self.background = None
        self.style = None
        self.pretty = False
        self.indent = 4
        self.inline = False

    def log(self,
            data=None,
            title="Unnamed Data",
            verbose=True,
            color=None,
            background=None,
            style=None,
            pretty=False,
            indent=4,
            inline=False):
        # Store settings for future use
        self.verbose = verbose
        self.color = color
        self.background = background
        self.style = style
        self.pretty = pretty
        self.indent = indent
        self.inline = inline

        # Add the log to the buffer
        self.buffer.append((data, title))

    def flush(self):
        for data, title in self.buffer:
            vcprint(
                data=data,
                title=title,
                verbose=self.verbose,
                color=self.color,
                background=self.background,
                style=self.style,
                pretty=self.pretty,
                indent=self.indent,
                inline=self.inline
            )
        self.buffer.clear()

    def flush_to_file(self, file_path):
        with open(file_path, 'w', encoding='utf-8') as file:
            for data, title in self.buffer:
                if self.pretty:
                    data_str = json.dumps(data, ensure_ascii=False, indent=self.indent)
                else:
                    data_str = str(data)
                file.write(f"{title}\n{data_str}\n\n")
        self.buffer.clear()


matrix_log_print = MatrixPrintLogger()


def clean_json_string(json_string):
    try:
        cleaned_dict = json.loads(json_string)
        return cleaned_dict
    except json.JSONDecodeError as e:
        print(f"Failed to decode JSON string: {e}")
        return None


def convert_to_json_compatible(data):
    """
    Recursively converts various data types into JSON-compatible formats.
    Returns a tuple of the converted data, the original data type, and the converted data type.
    """
    old_type = type(data).__name__
    new_type = old_type
    from decimal import Decimal
    from uuid import UUID
    import datetime

    if isinstance(data, (str, int, float, bool, type(None), UUID)):
        return str(data), old_type, new_type
    elif isinstance(data, (list, tuple)):
        converted_list = [convert_to_json_compatible(item)[0] for item in data]
        new_type = "list" if isinstance(data, list) else "tuple"
        return converted_list, old_type, new_type
    elif isinstance(data, dict):
        converted_dict = {key: convert_to_json_compatible(value)[0] for key, value in data.items()}
        return converted_dict, old_type, "dict"
    elif isinstance(data, datetime.datetime):
        return data.isoformat(), old_type, "str"
    elif isinstance(data, Decimal):
        return float(data), old_type, "float"
    elif hasattr(data, 'dict'):
        return {key: convert_to_json_compatible(value)[0] for key, value in data.dict().items()}, old_type, "dict"
    else:
        try:
            return str(data), old_type, "str"
        except Exception:
            return "This data type is:", old_type, "which is not compatible with pretty print."


def print_link(path):
    from urllib.parse import urlparse
    import os

    if not isinstance(path, str):
        path = str(path)

    if any(suffix in path.lower() for suffix in {'.com', '.org', '.net', '.io', '.us', '.gov'}):
        print(path)
        return

    if not isinstance(path, str):
        raise ValueError("The provided path must be a string.")

    parsed_path = urlparse(path)

    if parsed_path.scheme and parsed_path.netloc:
        print(path)

    else:
        if not os.path.isabs(path):
            path = os.path.abspath(path)
        url_compatible_path = path.replace("\\", "/")
        print("file:///{}".format(url_compatible_path))


def colorize(text, color=None, background=None, style=None):
    # ANSI escape codes for colors
    colors = {
        "black": "\033[30m",
        "light_red": "\033[31m",
        "light_green": "\033[32m",
        "light_yellow": "\033[33m",
        "light_blue": "\033[34m",
        "light_magenta": "\033[35m",
        "light_cyan": "\033[36m",
        "gray": "\033[37m",
        "dark_gray": "\033[90m",
        "red": "\033[91m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "magenta": "\033[95m",
        "cyan": "\033[96m",
        "white": "\033[97m",

        "bright_orange": "\033[38;5;208m",
        "bright_pink": "\033[38;5;205m",
        "bright_purple": "\033[38;5;129m",
        "bright_lime": "\033[38;5;118m",
        "bright_teal": "\033[38;5;51m",
        "bright_lavender": "\033[38;5;183m",
        "bright_turquoise": "\033[38;5;45m",
        "bright_gold": "\033[38;5;220m",
    }

    # ANSI escape codes for background colors
    backgrounds = {
        "black": "\033[40m",
        "light_red": "\033[41m",
        "light_green": "\033[42m",
        "light_yellow": "\033[43m",
        "light_blue": "\033[44m",
        "light_magenta": "\033[45m",
        "light_cyan": "\033[46m",
        "gray": "\033[47m",
        "dark_gray": "\033[100m",
        "red": "\033[101m",
        "green": "\033[102m",
        "yellow": "\033[103m",
        "blue": "\033[104m",
        "magenta": "\033[105m",
        "cyan": "\033[106m",
        "white": "\033[107m",
    }

    styles = {
        "bold": "\033[1m",
        "dim": "\033[2m",
        "italic": "\033[3m",
        "underline": "\033[4m",
        "blink": "\033[5m",
        "reverse": "\033[7m",
        "hidden": "\033[8m",
        "strikethrough": "\033[9m",
    }

    reset = "\033[0m"

    if background is None and color in ["black", "dark_gray"]:
        background = "white"
        style = "reverse"

    color_code = colors.get(color, "")
    background_code = backgrounds.get(background, "")
    style_code = styles.get(style, "")

    return f"{color_code}{background_code}{style_code}{text}{reset}"


def print_truncated(value, max_chars=250):
    """
    Safely print the value with a maximum character limit if applicable.
    If the value is a string, truncate it.
    Otherwise, print the value directly.
    """
    if isinstance(value, str):
        if len(value) > max_chars:
            truncated_value = (value[:max_chars])
            print(f"----Truncated Value----\n{truncated_value}...\n----------")
    else:
        print(value)


def cool_print(text, color, background=None, style=None):
    print(colorize(text, color, background, style))


def pretty_verbose(data, verbose=False, title=None):
    if verbose:
        pretty_print(data, title)


def cool_verbose(data, verbose=False, color="light_blue", background=None, style=None):
    if verbose:
        cool_print(text=data, color=color, background=background, style=style)


class InlinePrinter:

    def __init__(self, prefix="", separator=" | "):
        self.prefix = prefix
        self.separator = separator
        self.first_item = True

    def print(self, item, color="blue", end=False):
        if self.first_item:
            print(colorize(self.prefix, "magenta"), end="", flush=True)
            self.first_item = False
        else:
            print(self.separator, end="", flush=True)

        print(colorize(item, color), end="", flush=True)

        if end:
            print()

        sys.stdout.flush()


def create_inline_printer(prefix="[AI Matrix] ", separator=" | "):
    return InlinePrinter(prefix, separator)


def vprint(verbose=False, *args, **kwargs):
    if verbose:
        print(*args, **kwargs)


def print_black(text, style=None):
    print(colorize(text, "black", style=style))


def print_red(text, style=None):
    print(colorize(text, "light_red", style=style))


def print_green(text, style=None):
    print(colorize(text, "light_green", style=style))


def print_yellow(text, style=None):
    print(colorize(text, "light_yellow", style=style))


def print_blue(text, style=None):
    print(colorize(text, "light_blue", style=style))


def print_magenta(text, style=None):
    print(colorize(text, "light_magenta", style=style))


def print_cyan(text, style=None):
    print(colorize(text, "light_cyan", style=style))


def print_light_gray(text, style=None):
    print(colorize(text, "gray", style=style))


def print_dark_gray(text, style=None):
    print(colorize(text, "dark_gray", style=style))


def print_light_red(text, style=None):
    print(colorize(text, "red", style=style))


def print_light_green(text, style=None):
    print(colorize(text, "green", style=style))


def print_light_yellow(text, style=None):
    print(colorize(text, "yellow", style=style))


def print_light_blue(text, style=None):
    print(colorize(text, "blue", style=style))


def print_light_magenta(text, style=None):
    print(colorize(text, "magenta", style=style))


def print_light_cyan(text, style=None):
    print(colorize(text, "cyan", style=style))


def print_white(text, style=None):
    print(colorize(text, "white", style=style))


def print_bold(text):
    print(colorize(text, "bold"))


def print_bold_red(text):
    print(colorize(text, "light_red", style="bold"))


def print_bold_green(text):
    print(colorize(text, "light_green", style="bold"))


def print_bold_yellow(text):
    print(colorize(text, "light_yellow", style="bold"))


def print_bold_blue(text):
    print(colorize(text, "light_blue", style="bold"))


def print_bold_magenta(text):
    print(colorize(text, "light_magenta", style="bold"))


def print_bold_cyan(text):
    print(colorize(text, "light_cyan", style="bold"))


def print_bold_white(text):
    print(colorize(text, "white", style="bold"))


def print_underline_red(text):
    print(colorize(text, "light_red", style="underline"))


def print_underline_green(text):
    print(colorize(text, "light_green", style="underline"))


def print_underline_yellow(text):
    print(colorize(text, "light_yellow", style="underline"))


def print_underline_blue(text):
    print(colorize(text, "light_blue", style="underline"))


def print_blink(text):
    print(colorize(text, "light_red", style="blink"))


def print_blink_red(text):
    print(colorize(text, "light_red", style="blink"))


def print_blink_green(text):
    print(colorize(text, "light_green", style="blink"))


def print_blink_yellow(text):
    print(colorize(text, "light_yellow", style="blink"))


def print_blink_blue(text):
    print(colorize(text, "light_blue", style="blink"))


def print_dim(text):
    print(colorize(text, "light_red", style="dim"))


def print_dim_red(text):
    print(colorize(text, "light_red", style="dim"))


def print_dim_green(text):
    print(colorize(text, "light_green", style="dim"))


def print_dim_yellow(text):
    print(colorize(text, "light_yellow", style="dim"))


def print_dim_blue(text):
    print(colorize(text, "light_blue", style="dim"))


def print_background_red(text):
    print(colorize(text, "white", background="light_red"))


def print_background_green(text):
    print(colorize(text, "white", background="light_green"))


def print_background_yellow(text):
    print(colorize(text, "white", background="light_yellow"))


def print_background_blue(text):
    print(colorize(text, "white", background="light_blue"))


def is_empty(value):
    """
    Recursively check if a value is considered empty.
    - None, empty strings, empty dictionaries, and empty lists are considered empty.
    - For dictionaries, all values must be empty for it to be considered empty.
    """
    if value is None or value == "" or (isinstance(value, (list, dict)) and not value):
        return True
    if isinstance(value, dict):
        return all(is_empty(v) for v in value.values())
    if isinstance(value, list):
        return all(is_empty(v) for v in value)
    return False


def vclist(
        data=None,
        title="Unnamed Data",
        verbose=True,
        color=None,
        background=None,
        style=None,
        pretty=False,
        indent=4,
        inline=False
):
    """
    Wrapper for vcprint that handles lists of data.
    Calls vcprint for each item in the list, only including the title for the first item.
    Skips empty lists, empty items, empty dictionaries, and empty nested lists.
    """
    if not data:  # Check if data is None or an empty list
        return

    if isinstance(data, list):
        for index, item in enumerate(data):
            if is_empty(item):
                continue

            # Prepare arguments for vcprint
            vcprint_args = {
                'data': item,
                'verbose': verbose,
                'color': color,
                'background': background,
                'style': style,
                'pretty': pretty,
                'indent': indent,
                'inline': inline
            }

            if index == 0 and title:  # Only include the title for the first item
                vcprint_args['title'] = title

            vcprint(**vcprint_args)
    else:
        # If data is not a list, just call vcprint normally
        vcprint(
            data=data,
            title=title,
            verbose=verbose,
            color=color,
            background=background,
            style=style,
            pretty=pretty,
            indent=indent,
            inline=inline
        )


def vcdlist(
        data=None,
        verbose=True,
        color=None,
        background=None,
        style=None,
        pretty=False,
        indent=4,
        inline=False
):
    """
    Specialized wrapper for vcprint that handles a list of dictionaries.
    For each dictionary in the list, it calls vcprint with the dictionary's key as the title
    and its value as the data.
    Skips empty dictionaries and values.
    """
    if not data:  # Check if data is None or an empty list
        return

    if isinstance(data, list):
        for item in data:
            if is_empty(item):
                continue

            if isinstance(item, dict):
                for key, value in item.items():
                    if not is_empty(value):  # Ensure value is not empty
                        vcprint(
                            data=value,
                            title=key,
                            verbose=verbose,
                            color=color,
                            background=background,
                            style=style,
                            pretty=pretty,
                            indent=indent,
                            inline=inline
                        )
    else:
        # If data is not a list, just call vcprint normally
        vcprint(
            data=data,
            verbose=verbose,
            color=color,
            background=background,
            style=style,
            pretty=pretty,
            indent=indent,
            inline=inline
        )


def get_random_color():
    import random
    all_colors = [
        "light_red", "light_green", "light_yellow", "light_blue", "light_magenta", "light_cyan",
        "gray", "dark_gray", "green", "yellow", "blue", "magenta", "cyan",
        "bright_orange", "bright_pink", "bright_purple", "bright_lime",
        "bright_teal", "bright_lavender", "bright_turquoise", "bright_gold"
    ]
    return random.choice(all_colors)
