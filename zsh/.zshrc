# .zshrc
#
# Maintained by Claud D. Park <posquit0.bj@gmail.com>
# http://www.posquit0.com/


### General: Oh-My-Zsh {{{
  # Path to your oh-my-zsh installation.
  export ZSH=$HOME/.oh-my-zsh
  # Would you like to use another custom folder than $ZSH/custom?
  ZSH_CUSTOM=$HOME/.oh-my-zsh-custom

  # Uncomment the following line to change how often to auto-update (in days).
  export UPDATE_ZSH_DAYS=3
  # Uncomment the following line to disable bi-weekly auto-update checks.
  # DISABLE_AUTO_UPDATE="true"
  
  # Uncomment the following line to disable auto-setting terminal title.
  DISABLE_AUTO_TITLE="true"
  # Uncomment the following line to use case-sensitive completion.
  CASE_SENSITIVE="true"
  # Uncomment the following line to enable command auto-correction.
  # ENABLE_CORRECTION="true"
  # Uncomment the following line to display red dots whilst waiting for completion.
  # COMPLETION_WAITING_DOTS="true"

  # Uncomment the following line if you want to disable marking untracked files
  # under VCS as dirty. This makes repository status check for large repositories
  # much, much faster.
  DISABLE_UNTRACKED_FILES_DIRTY="true"
  
  # Uncomment the following line if you want to change the command execution time
  # stamp shown in the history command output.
  # The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
  HIST_STAMPS="yyyy-mm-dd"

  # Uncomment the following line to disable colors in ls.
  # DISABLE_LS_COLORS="true"
  
  # Set name of the theme to load.
  # Look in ~/.oh-my-zsh/themes/
  # Optionally, if you set this to "random", it'll load a random theme each
  # time that oh-my-zsh is loaded.
  ZSH_THEME="posquit0"
### }}}


### Plugin List {{{
### Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
### Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
  # Add wisely, as too many plugins slow down shell startup.
  plugins=(
    # Autocompletion or alias
    screen supervisor 
    git git-flow mercurial docker
    mvn scala sbt
    python pip pylint pep8 virtualenv virtualenvwrapper fabric
    gem
    node npm cofee bower
    colored-man-pages
    history-substring-search
    # Useful tools  
    colorize catimg command-not-found common-aliases 
    encode64 jsontools urltools sudo gitignore themes
    emoji-clock
    # Just for fun
    nyan rand-quote
    # Custom or 3rd-party
    alias-tips zsh-syntax-highlighting autosuggestions
    resty
  )
### }}}

source $ZSH/oh-my-zsh.sh

### General {{{
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games"
  export MANPATH="/usr/local/man:$MANPATH"
  
  # You may need to manually set your language environment
  export LANG=ko_KR.UTF-8
  export LC_ALL=ko_KR.UTF-8

  # Load alias list
  if [ -f "$HOME/.alias" ]; then
    source "$HOME/.alias"
  fi

  # Always enable colored `grep` output
  export GREP_OPTIONS="--color=auto";

  # Set term that supports 256 colors
  # export TERM=screen-256color
  # Preferred editor for local and remote sessions
  if [[ -n $SSH_CONNECTION ]]; then
    export EDITOR='vim'
  else
    export EDITOR='vim'
  fi

  # Compilation flags
  # export ARCHFLAGS="-arch x86_64"

  # ssh
  # export SSH_KEY_PATH="~/.ssh/dsa_id"
### }}}


### User Configuration {{{
  # User binaries
  export PATH="$PATH:$HOME/.bin"
  # Ruby
  eval "$(rbenv init -)"
  # Node.JS
  [ -f ~/.tools/nvm/nvm.sh ] && source ~/.tools/nvm/nvm.sh
  # Fzf(Fuzzy Finder)
  # Usage: Ctrl+T, Ctrl+R, Alt+C
  if [ -f ~/.fzf.zsh  ]; then
    source ~/.fzf.zsh
    bindkey '^T' fzf-completion
    bindkey '^I' $fzf_default_completion
  fi

### }}}


### Plugin Configuration {{{
  ## Plugin: History-Substring-Search {{
    # Bind UP and DOWN arrow keys
    zmodload zsh/terminfo
    bindkey "$terminfo[kcuu1]" history-substring-search-up
    bindkey "$terminfo[kcud1]" history-substring-search-down
    # Bind UP and DOWN arrow keys (compatibility fallback
    # for Ubuntu 12.04, Fedora 21, and MacOSX 10.9 users)
    bindkey '^[[A' history-substring-search-up
    bindkey '^[[B' history-substring-search-down
    # Bind P and N for EMACS mode
    bindkey -M emacs '^P' history-substring-search-up
    bindkey -M emacs '^N' history-substring-search-down
    # Bind k and j for VI mode
    bindkey -M vicmd 'k' history-substring-search-up
    bindkey -M vicmd 'j' history-substring-search-down
  ## }}
  ## Plugin: Autosuggestions {{
    # Enable autosuggestions automatically.
    zle-line-init() {
      zle autosuggest-start
    }
    zle -N zle-line-init
    # Use ctrl+t to toggle autosuggestions(hopefully this wont be needed as
    # zsh-autosuggestions is designed to be unobtrusive)
    # bindkey '^T' autosuggest-toggle
    # Accept suggestions without leaving insert mode
    bindkey '^f' vi-forward-blank-word
    # Complete entire suggestion with right arrow
    AUTOSUGGESTION_ACCEPT_RIGHT_ARROW=1
  ## }}
### }}}
