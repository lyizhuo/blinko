package com.plugin.blinko

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.content.Context

class Blinko {
    /**
     * Applies the app theme to the system bars.
     *
     * The activity runs edge-to-edge, so the bars themselves are transparent and the app
     * content scrolls behind them. Only the icon/gesture-bar contrast has to follow the
     * theme, so all this does is flip the light/dark appearance flags.
     */
    fun setcolor(hex: String, activity: Activity) {
        val color = Color.parseColor(hex)
        val isLightColor = isColorLight(color)

        // Save theme preference with the original hex so the startup theme matches.
        saveThemePreference(activity, !isLightColor, hex)

        // Light background -> dark icons, dark background -> light icons.
        applyBarIconAppearance(activity, darkIcons = isLightColor)
    }

    private fun applyBarIconAppearance(activity: Activity, darkIcons: Boolean) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                activity.window.insetsController?.setSystemBarsAppearance(
                    if (darkIcons) mask else 0,
                    mask
                )
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // Preserve the layout flags set by enableEdgeToEdge(), only toggle the
                // light-icon flags.
                val decor = activity.window.decorView
                var flags = decor.systemUiVisibility
                flags = flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags = flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
                }
                if (darkIcons) {
                    flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                    }
                }
                @Suppress("DEPRECATION")
                decor.systemUiVisibility = flags
            }
        } catch (e: Exception) {
            Log.e("Blinko", "Error applying bar icon appearance: ${e.message}")
        }
    }

    /**
     * Current system bar + display cutout insets, in density independent pixels.
     * The WebView runs edge-to-edge and needs these to keep tap targets clear of the bars.
     */
    fun getSafeAreaInsets(activity: Activity): Map<String, Float> {
        val density = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        var left = 0
        var top = 0
        var right = 0
        var bottom = 0

        try {
            val insets = activity.window.decorView.rootWindowInsets
            if (insets != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(
                        WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
                    )
                    left = bars.left
                    top = bars.top
                    right = bars.right
                    bottom = bars.bottom
                } else {
                    @Suppress("DEPRECATION")
                    run {
                        left = insets.systemWindowInsetLeft
                        top = insets.systemWindowInsetTop
                        right = insets.systemWindowInsetRight
                        bottom = insets.systemWindowInsetBottom
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        insets.displayCutout?.let { cutout ->
                            left = maxOf(left, cutout.safeInsetLeft)
                            top = maxOf(top, cutout.safeInsetTop)
                            right = maxOf(right, cutout.safeInsetRight)
                            bottom = maxOf(bottom, cutout.safeInsetBottom)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("Blinko", "Error reading window insets: ${e.message}")
        }

        return mapOf(
            "top" to top / density,
            "right" to right / density,
            "bottom" to bottom / density,
            "left" to left / density
        )
    }

    private fun isColorLight(color: Int): Boolean {
        val red = Color.red(color)
        val green = Color.green(color)
        val blue = Color.blue(color)
        val brightness = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
        return brightness > 0.5
    }

    private fun saveThemePreference(activity: Activity, isDarkMode: Boolean, hexColor: String) {
        try {
            val sharedPref = activity.getSharedPreferences("blinko_theme", Context.MODE_PRIVATE)
            with(sharedPref.edit()) {
                putBoolean("dark_mode", isDarkMode)
                putString("last_color", hexColor)
                apply()
            }
            Log.i("Blinko", "Theme preference saved: isDark=$isDarkMode, color=$hexColor")
        } catch (e: Exception) {
            Log.e("Blinko", "Error saving theme preference: ${e.message}")
        }
    }

    fun getSavedTheme(activity: Activity): Map<String, Any> {
        return try {
            val sharedPref = activity.getSharedPreferences("blinko_theme", Context.MODE_PRIVATE)
            val isDarkMode = sharedPref.getBoolean("dark_mode", false)
            val lastColor = sharedPref.getString("last_color", "#FFFFFF") ?: "#FFFFFF"

            mapOf(
                "isDarkMode" to isDarkMode,
                "lastColor" to lastColor
            )
        } catch (e: Exception) {
            Log.e("Blinko", "Error getting saved theme: ${e.message}")
            mapOf(
                "isDarkMode" to false,
                "lastColor" to "#FFFFFF"
            )
        }
    }

    fun applyStartupTheme(activity: Activity) {
        try {
            val savedTheme = getSavedTheme(activity)
            val lastColor = savedTheme["lastColor"] as String
            setcolor(lastColor, activity)
            Log.i("Blinko", "Startup theme applied: $lastColor")
        } catch (e: Exception) {
            Log.e("Blinko", "Error applying startup theme: ${e.message}")
        }
    }

    fun openAppSettings(activity: Activity) {
        try {
            // Try to open app-specific settings
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            val uri = Uri.fromParts("package", activity.packageName, null)
            intent.data = uri
            activity.startActivity(intent)
        } catch (e: Exception) {
            // Fallback to general settings if specific app settings fail
            try {
                val intent = Intent(Settings.ACTION_SETTINGS)
                activity.startActivity(intent)
            } catch (fallbackException: Exception) {
                Log.e("Blinko", "Failed to open settings: ${fallbackException.message}")
            }
        }
    }
}
