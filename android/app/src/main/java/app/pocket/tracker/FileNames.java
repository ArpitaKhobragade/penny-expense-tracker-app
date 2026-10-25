package app.pocket.tracker;

/** Checks file names handed in from the web page, so a name can never point to another folder. */
final class FileNames {
    private FileNames() {}

    /** Plain names only: letters, digits, dot, dash and underscore, not starting with a dot. */
    static boolean isSafe(String name) {
        return name != null && name.matches("[A-Za-z0-9._-]{1,80}") && !name.startsWith(".");
    }
}
