package com.plugin.blinko

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

@InvokeArg
class SetColorArgs {
  lateinit var hex: String
}


@TauriPlugin
class BlinkoPlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = Blinko()

    @Command
    fun setcolor(invoke: Invoke) {
        val args = invoke.parseArgs(SetColorArgs::class.java)
        implementation.setcolor(args.hex, activity)
        invoke.resolve()
    }

    @Command
    fun openAppSettings(invoke: Invoke) {
        implementation.openAppSettings(activity)
        invoke.resolve()
    }

    @Command
    fun getSafeAreaInsets(invoke: Invoke) {
        // Window insets must be read on the UI thread.
        activity.runOnUiThread {
            val insets = implementation.getSafeAreaInsets(activity)
            val result = JSObject()
            result.put("top", insets["top"])
            result.put("right", insets["right"])
            result.put("bottom", insets["bottom"])
            result.put("left", insets["left"])
            invoke.resolve(result)
        }
    }
}
