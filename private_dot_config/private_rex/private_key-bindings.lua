-- Rex config migrated from tmux, zellij, Herdr, Ghostty and iTerm2.

---------------------------------------------------------------------------
-- tmux (~/.tmux.conf)
---------------------------------------------------------------------------
rex.bind("ctrl+a>r", "client.config.reload")                          -- :43
rex.bind("ctrl+a>ctrl+l", "pane.send_key", { key = "ctrl+l" })        -- :65
rex.bind("ctrl+a>ctrl+a", "client.mode.enter", { name = "shells" })   -- :305
-- tmux key table "shells": its g/k/t bindings run custom_shpell popups and are
-- not migrated. Esc (Rex's usual way out of a mode) keeps the mode defined.
rex.bind("shells/esc", "client.mode.exit")

---------------------------------------------------------------------------
-- Herdr (~/.config/herdr/config.toml)
---------------------------------------------------------------------------
rex.bind("ctrl+a>shift+r", "client.config.reload")
rex.bind("ctrl+a>g", "session.switch")
rex.bind("ctrl+a>w", "session.switch")
rex.bind("ctrl+a>up", "session.previous")
rex.bind("ctrl+a>down", "session.next")
rex.bind("ctrl+a>c", "client.tab.new")
rex.bind("ctrl+a>1", "client.tab.goto", { index = 1 })
rex.bind("ctrl+a>2", "client.tab.goto", { index = 2 })
rex.bind("ctrl+a>3", "client.tab.goto", { index = 3 })
rex.bind("ctrl+a>4", "client.tab.goto", { index = 4 })
rex.bind("ctrl+a>5", "client.tab.goto", { index = 5 })
rex.bind("ctrl+a>6", "client.tab.goto", { index = 6 })
rex.bind("ctrl+a>7", "client.tab.goto", { index = 7 })
rex.bind("ctrl+a>8", "client.tab.goto", { index = 8 })
rex.bind("ctrl+a>9", "client.tab.goto", { index = 9 })
rex.bind("ctrl+a>n", "client.tab.next")
rex.bind("ctrl+a>right", "client.tab.next")
rex.bind("ctrl+a>p", "client.tab.previous")
rex.bind("ctrl+a>left", "client.tab.previous")
rex.bind("ctrl+a>ctrl+k", "com.superlogical.terminal.clear")
rex.bind("ctrl+a>h", "pane.focus", { direction = "left" })
rex.bind("alt+h", "pane.focus", { direction = "left" })
rex.bind("ctrl+a>j", "pane.focus", { direction = "down" })
rex.bind("alt+j", "pane.focus", { direction = "down" })
rex.bind("ctrl+a>k", "pane.focus", { direction = "up" })
rex.bind("alt+k", "pane.focus", { direction = "up" })
rex.bind("ctrl+a>l", "pane.focus", { direction = "right" })
rex.bind("alt+l", "pane.focus", { direction = "right" })
rex.bind("ctrl+a>shift+h", "pane.resize", { direction = "left" })
rex.bind("ctrl+a>shift+j", "pane.resize", { direction = "down" })
rex.bind("ctrl+a>shift+k", "pane.resize", { direction = "up" })
rex.bind("ctrl+a>shift+l", "pane.resize", { direction = "right" })
rex.bind("ctrl+a>-", "pane.split", { direction = "down" })
rex.bind("ctrl+a>shift+\\", "pane.split", { direction = "right" })

---------------------------------------------------------------------------
-- zellij (~/.config/zellij/config.kdl)
---------------------------------------------------------------------------
rex.action{
  name  = "then_normal",
  title = "Run an action and return to normal mode",
  args  = { action = "string", args = "object?" },
  run   = function(ctx, args)
    rex.client.queue(args.action, args.args or {})
    rex.client.queue("client.mode.exit_all")
  end,
}

-- Normal mode (no Rex mode); alt+h/j/k/l come from Herdr above.
rex.bind("alt+n", "pane.split", { direction = "auto" })                -- :143
rex.bind("alt+left", "pane.focus", { direction = "left" })             -- :144
rex.bind("alt+right", "pane.focus", { direction = "right" })           -- :145
rex.bind("alt+down", "pane.focus", { direction = "down" })             -- :146
rex.bind("alt+up", "pane.focus", { direction = "up" })                 -- :147
rex.bind("ctrl+p", "client.mode.enter", { name = "pane" })             -- :157
rex.bind("ctrl+n", "client.mode.enter", { name = "resize" })           -- :160
rex.bind("ctrl+t", "client.mode.enter", { name = "tab" })              -- :169
rex.bind("ctrl+h", "client.mode.enter", { name = "move" })             -- :172
rex.bind("ctrl+b", "client.mode.enter", { name = "tmux" })             -- :175

local zmodes = { "resize", "pane", "move", "tab", "tmux" }
for _, m in ipairs(zmodes) do
  rex.mode(m, { exclusive = true })
end

-- shared_except blocks: the same keys in every mode they apply to.
local enter_keys = { pane = "ctrl+p", resize = "ctrl+n", tab = "ctrl+t", move = "ctrl+h", tmux = "ctrl+b" }
for _, m in ipairs(zmodes) do
  rex.bind(m .. "/alt+n", "pane.split", { direction = "auto" })
  rex.bind(m .. "/alt+h", "pane.focus", { direction = "left" })
  rex.bind(m .. "/alt+left", "pane.focus", { direction = "left" })
  rex.bind(m .. "/alt+l", "pane.focus", { direction = "right" })
  rex.bind(m .. "/alt+right", "pane.focus", { direction = "right" })
  rex.bind(m .. "/alt+j", "pane.focus", { direction = "down" })
  rex.bind(m .. "/alt+down", "pane.focus", { direction = "down" })
  rex.bind(m .. "/alt+k", "pane.focus", { direction = "up" })
  rex.bind(m .. "/alt+up", "pane.focus", { direction = "up" })
  rex.bind(m .. "/enter", "client.mode.exit_all")
  rex.bind(m .. "/esc", "client.mode.exit_all")
  for target, key in pairs(enter_keys) do
    if target ~= m then
      rex.bind(m .. "/" .. key, "client.mode.enter", { name = target })
    end
  end
end

-- resize
rex.bind("resize/ctrl+n", "client.mode.exit_all")
for _, k in ipairs({ { "h", "left" }, { "left", "left" }, { "j", "down" }, { "down", "down" },
                     { "k", "up" }, { "up", "up" }, { "l", "right" }, { "right", "right" } }) do
  rex.bind("resize/" .. k[1], "pane.resize", { direction = k[2] })
end

-- pane
rex.bind("pane/ctrl+p", "client.mode.exit_all")
for _, k in ipairs({ { "h", "left" }, { "left", "left" }, { "l", "right" }, { "right", "right" },
                     { "j", "down" }, { "down", "down" }, { "k", "up" }, { "up", "up" } }) do
  rex.bind("pane/" .. k[1], "pane.focus", { direction = k[2] })
end
rex.bind("pane/n", "then_normal", { action = "pane.split", args = { direction = "auto" } })
rex.bind("pane/d", "then_normal", { action = "pane.split", args = { direction = "down" } })
rex.bind("pane/r", "then_normal", { action = "pane.split", args = { direction = "right" } })
rex.bind("pane/x", "then_normal", { action = "pane.close" })
rex.bind("pane/f", "then_normal", { action = "pane.zoom" })
rex.bind("pane/c", "then_normal", { action = "pane.rename" })

-- move
rex.bind("move/ctrl+h", "client.mode.exit_all")
for _, k in ipairs({ { "h", "left" }, { "left", "left" }, { "j", "down" }, { "down", "down" },
                     { "k", "up" }, { "up", "up" }, { "l", "right" }, { "right", "right" } }) do
  rex.bind("move/" .. k[1], "pane.move", { direction = k[2] })
end

-- tab
rex.bind("tab/ctrl+t", "client.mode.exit_all")
rex.bind("tab/r", "then_normal", { action = "client.tab.rename" })
for _, k in ipairs({ "h", "left", "up", "k" }) do rex.bind("tab/" .. k, "client.tab.previous") end
for _, k in ipairs({ "l", "right", "down", "j" }) do rex.bind("tab/" .. k, "client.tab.next") end
rex.bind("tab/n", "then_normal", { action = "client.tab.new" })
rex.bind("tab/x", "then_normal", { action = "client.tab.close" })
for i = 1, 9 do
  rex.bind("tab/" .. i, "then_normal", { action = "client.tab.goto", args = { index = i } })
end

-- tmux
rex.bind("tmux/ctrl+b", "then_normal", { action = "pane.send_key", args = { key = "ctrl+b" } })
rex.bind("tmux/shift+'", "then_normal", { action = "pane.split", args = { direction = "down" } })
rex.bind("tmux/shift+5", "then_normal", { action = "pane.split", args = { direction = "right" } })
rex.bind("tmux/z", "then_normal", { action = "pane.zoom" })
rex.bind("tmux/c", "then_normal", { action = "client.tab.new" })
rex.bind("tmux/,", "then_normal", { action = "client.tab.rename" })
rex.bind("tmux/p", "then_normal", { action = "client.tab.previous" })
rex.bind("tmux/n", "then_normal", { action = "client.tab.next" })
for _, k in ipairs({ { "left", "left" }, { "right", "right" }, { "down", "down" }, { "up", "up" },
                     { "h", "left" }, { "l", "right" }, { "j", "down" }, { "k", "up" } }) do
  rex.bind("tmux/" .. k[1], "then_normal", { action = "pane.focus", args = { direction = k[2] } })
end
rex.bind("tmux/o", "pane.focus_next")
rex.bind("tmux/x", "then_normal", { action = "pane.close" })

---------------------------------------------------------------------------
-- iTerm2 (Default profile Keyboard Map: single-byte hex codes)
---------------------------------------------------------------------------
rex.bind("ctrl+2", "pane.send_key", { key = "ctrl+shift+2" })  -- 0x32-0x40000 -> 0x00
rex.bind("ctrl+3", "pane.send_key", { key = "esc" })           -- 0x33-0x40000 -> 0x1b
rex.bind("ctrl+4", "pane.send_key", { key = "ctrl+\\" })       -- 0x34-0x40000 -> 0x1c
rex.bind("ctrl+5", "pane.send_key", { key = "ctrl+]" })        -- 0x35-0x40000 -> 0x1d
rex.bind("ctrl+6", "pane.send_key", { key = "ctrl+shift+6" })  -- 0x36-0x40000 -> 0x1e
rex.bind("ctrl+7", "pane.send_key", { key = "ctrl+shift+-" })  -- 0x37-0x40000 -> 0x1f
rex.bind("ctrl+8", "pane.send_key", { key = "backspace" })     -- 0x38-0x40000 -> 0x7f
rex.bind("ctrl+-", "pane.send_key", { key = "ctrl+shift+-" })  -- 0x2d-0x40000 -> 0x1f
